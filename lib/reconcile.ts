import { db, ready } from "./db";
import { getSkill } from "./skills";
import { recordRunOnChain, registryEnabled } from "./registry";
import { recordRunCompressed, zkReceiptsEnabled } from "./zk-receipts";
import { anchorOnChain } from "./receipt";
import { setRunRegistryAnchor, setRunZkAnchor } from "./runs";
import { logError, logInfo } from "./log";

/**
 * On-chain anchor reconciliation.
 *
 * Every anchor path (the Memo Merkle batch, the registry program, the ZK receipt)
 * is best-effort with a 60s confirm bound. If a transaction BROADCASTS and lands
 * but confirmation exceeds that bound, the send returns null and the signature is
 * never persisted — leaving a batch with sig=NULL (its root never re-anchored,
 * because batched runs are excluded from the next tick) or a completed run with a
 * null registry_sig/zk_sig. Nothing re-tried these before this reconciler.
 *
 * Each reconciler here is idempotent by construction:
 *  - Batch: re-anchors ONLY sig-NULL batches; the Memo root is deterministic, and
 *    the sig-IS-NULL guards make the backfill a no-op once set.
 *  - Registry/ZK: recordRunOnChain/recordRunCompressed already guard against a
 *    double-record (the receipt PDA / validity proof), so re-attempting a run that
 *    actually landed is a safe no-op; one that didn't land gets a fresh signature.
 *
 * Only recent runs/batches are reconciled (RECONCILE_WINDOW_MS) so a permanently
 * sig-lost-but-landed record doesn't get retried forever.
 */

const RECONCILE_WINDOW_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.AEMULUS_RECONCILE_WINDOW_MS) || 24 * 60 * 60 * 1000,
);
const RECONCILE_MAX = Math.max(1, Number(process.env.AEMULUS_RECONCILE_MAX) || 50);
// A pending claim older than this with no signature is surfaced for an operator
// (it can't be safely auto-retried — see reconcilePendingClaims).
const STUCK_CLAIM_MS = 15 * 60 * 1000;

/** A Memo signer is configured (the batch anchor path is live). */
function memoAnchorEnabled(): boolean {
  return !!process.env.AEMULUS_RECEIPT_SECRET;
}

/**
 * Re-anchor batches whose Memo root never got a signature (confirm timeout). On
 * success, backfill the batch's sig AND every run in it (their receipt_sig was
 * also left null). Returns how many batches were newly anchored.
 */
export async function reconcileBatchAnchors(max = RECONCILE_MAX): Promise<number> {
  if (!memoAnchorEnabled()) return 0;
  await ready();
  const cutoff = Date.now() - RECONCILE_WINDOW_MS;
  const pending = await db.execute({
    sql: `SELECT id, merkle_root FROM receipt_batches
          WHERE sig IS NULL AND created_at > ?
          ORDER BY created_at ASC LIMIT ?`,
    args: [cutoff, max],
  });
  let anchored = 0;
  for (const row of pending.rows) {
    const batchId = String(row.id);
    const root = String(row.merkle_root);
    try {
      const res = await anchorOnChain(`aemulus:batch:${root}`);
      if (!res) continue; // still couldn't anchor (RPC down / no signer) — retry next tick
      // Backfill the batch and its runs; the sig-IS-NULL guards keep this a no-op
      // if a concurrent path already set them.
      await db.execute({
        sql: `UPDATE receipt_batches SET sig = ?, cluster = ? WHERE id = ? AND sig IS NULL`,
        args: [res.sig, res.cluster, batchId],
      });
      await db.execute({
        sql: `UPDATE runs SET receipt_sig = ?, receipt_cluster = ? WHERE batch_id = ? AND receipt_sig IS NULL`,
        args: [res.sig, res.cluster, batchId],
      });
      anchored++;
    } catch (e) {
      logError("reconcile.batch", e, { batchId });
    }
  }
  return anchored;
}

/** Re-attempt the registry anchor for completed runs missing a registry_sig. */
export async function reconcileRegistryAnchors(max = RECONCILE_MAX): Promise<number> {
  if (!registryEnabled()) return 0;
  await ready();
  const cutoff = Date.now() - RECONCILE_WINDOW_MS;
  const rows = await db.execute({
    sql: `SELECT id, skill_id, receipt_hash, commitment_root, outcome_status FROM runs
          WHERE status = 'completed' AND receipt_hash IS NOT NULL
                AND registry_sig IS NULL AND created_at > ?
          ORDER BY created_at ASC LIMIT ?`,
    args: [cutoff, max],
  });
  let anchored = 0;
  for (const row of rows.rows) {
    const runId = String(row.id);
    try {
      const skill = await getSkill(String(row.skill_id));
      if (!skill) continue; // skill deleted — nothing to register
      const res = await recordRunOnChain(skill, {
        receiptHash: row.receipt_hash == null ? null : String(row.receipt_hash),
        commitmentRoot: row.commitment_root == null ? null : String(row.commitment_root),
        outcomeStatus: row.outcome_status == null ? null : String(row.outcome_status),
      });
      if (res) {
        await setRunRegistryAnchor(runId, res.sig, res.cluster);
        anchored++;
      }
    } catch (e) {
      logError("reconcile.registry", e, { runId });
    }
  }
  return anchored;
}

/** Re-attempt the ZK-compressed anchor for completed runs missing a zk_sig. */
export async function reconcileZkAnchors(max = RECONCILE_MAX): Promise<number> {
  if (!zkReceiptsEnabled()) return 0;
  await ready();
  const cutoff = Date.now() - RECONCILE_WINDOW_MS;
  const rows = await db.execute({
    sql: `SELECT id, receipt_hash, commitment_root, outcome_status FROM runs
          WHERE status = 'completed' AND receipt_hash IS NOT NULL
                AND zk_sig IS NULL AND created_at > ?
          ORDER BY created_at ASC LIMIT ?`,
    args: [cutoff, max],
  });
  let anchored = 0;
  for (const row of rows.rows) {
    const runId = String(row.id);
    try {
      const res = await recordRunCompressed({
        receiptHash: row.receipt_hash == null ? null : String(row.receipt_hash),
        commitmentRoot: row.commitment_root == null ? null : String(row.commitment_root),
        outcomeStatus: row.outcome_status == null ? null : String(row.outcome_status),
      });
      if (res) {
        await setRunZkAnchor(runId, res.sig, res.address, res.cluster);
        anchored++;
      }
    } catch (e) {
      logError("reconcile.zk", e, { runId });
    }
  }
  return anchored;
}

/**
 * A claim whose payout may have broadcast but whose confirmation was lost is left
 * pending (sig NULL) ON PURPOSE — auto-retrying a transfer we can't prove failed
 * risks a DOUBLE payout, and a plain SPL transfer carries no reference to match it
 * back to the claim. So this only SURFACES long-stuck pending claims for an
 * operator to reconcile against the treasury's history by hand. Returns the count.
 * (A future safe auto-reconcile would need the payout to carry the claim id.)
 */
export async function reconcilePendingClaims(): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM claims WHERE sig IS NULL AND created_at < ?`,
    args: [Date.now() - STUCK_CLAIM_MS],
  });
  const n = Number(r.rows[0]?.n ?? 0);
  if (n > 0) {
    logError(
      "reconcile.claims",
      new Error(`${n} claim(s) pending with no signature > ${Math.round(STUCK_CLAIM_MS / 60000)}m — reconcile against the treasury by hand`),
    );
  }
  return n;
}

let running = false;

/** One reconciliation pass over all anchor types (re-entrancy-guarded). */
export async function reconcileAnchors(): Promise<{ batch: number; registry: number; zk: number; stuckClaims: number }> {
  if (running) return { batch: 0, registry: 0, zk: 0, stuckClaims: 0 };
  running = true;
  try {
    const batch = await reconcileBatchAnchors();
    const registry = await reconcileRegistryAnchors();
    const zk = await reconcileZkAnchors();
    const stuckClaims = await reconcilePendingClaims();
    if (batch || registry || zk) {
      logInfo("reconcile", "recovered anchors", { batch, registry, zk });
    }
    return { batch, registry, zk, stuckClaims };
  } finally {
    running = false;
  }
}

declare global {
  var __aemReconciler: ReturnType<typeof setInterval> | undefined;
}

/** Periodically reconcile lost anchor signatures. Fully inert (never starts the
 *  interval) unless at least one anchor path is configured, so pre-launch there is
 *  no wasted work. */
export function startReconciler(): void {
  if (globalThis.__aemReconciler) return;
  if (!memoAnchorEnabled() && !registryEnabled() && !zkReceiptsEnabled()) return;
  const ms = Math.max(30_000, Number(process.env.AEMULUS_RECONCILE_MS) || 5 * 60 * 1000);
  globalThis.__aemReconciler = setInterval(() => {
    reconcileAnchors().catch((e) => logError("reconcile.tick", e));
  }, ms);
  logInfo("reconciler", `started (${ms}ms)`);
}
