import { db, ready } from "./db";
import { getSkill } from "./skills";
import { recordRunOnChain, registryEnabled } from "./registry";
import { recordRunCompressed, zkReceiptsEnabled } from "./zk-receipts";
import { anchorOnChain } from "./receipt";
import { findClaimPayouts, payoutsEnabled } from "./payout";
import { listPendingClaims, settleClaim, rollbackClaim } from "./earnings";
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
// Surfaced-only threshold when the treasury isn't configured (can't reconcile).
const STUCK_CLAIM_MS = 15 * 60 * 1000;
// A pending claim not found on-chain past this age is DEFINITIVELY unpaid (well
// beyond Solana's ~90s blockhash validity, so the tx can no longer land) and safe
// to roll back — provided the history scan actually reached back before it.
const SETTLE_GRACE_MS = 10 * 60 * 1000;

// Auto-rollback un-claims earnings (enabling a re-claim) based on the payout being
// ABSENT from the treasury's memo history. That is only as trustworthy as the RPC's
// memo indexing — if a payout actually landed but its memo isn't surfaced, an auto
// rollback DOUBLE-PAYS the creator. So it's OPT-IN: by default a confirmed-absent
// claim is SURFACED for an operator to verify on the explorer and roll back by hand
// (rollbackClaim). Enable only after confirming the RPC reliably surfaces payout
// memos AND that no pending claim predates payout-memo support.
function autoRollbackEnabled(): boolean {
  return process.env.AEMULUS_CLAIM_AUTO_ROLLBACK === "1";
}

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
 * Reconcile claims whose payout confirmation was lost (sig NULL). Each payout
 * carries an on-chain memo of its claim id (see sendPayout), so we scan the
 * treasury's history and:
 *  - SETTLE a claim whose payout IS found on-chain (record the real signature).
 *    Presence-based and provably safe: the memo only appears on a SUCCESSFUL,
 *    atomic payout tx, so a match means the transfer happened.
 *  - Otherwise, if the payout is ABSENT and the claim is old enough that its
 *    blockhash has long expired (can never land) AND the scan reached back before
 *    it, the claim is CONFIRMED-ABSENT: eligible for rollback. But rolling back
 *    un-claims earnings (enabling a re-claim), which DOUBLE-PAYS if the payout
 *    actually landed and the RPC merely didn't surface its memo — so it is only
 *    performed automatically under the AEMULUS_CLAIM_AUTO_ROLLBACK opt-in;
 *    otherwise it's SURFACED for manual verification (needsReview).
 *  - LEAVE PENDING anything too recent, or old-but-not-yet-scanned-back-to (the
 *    bounded scan capped out on a busy treasury — absence is NOT confirmed).
 * Without a configured treasury it can't reconcile, so it just surfaces stuck ones.
 */
export interface ClaimReconcileResult {
  settled: number;
  rolledBack: number;
  /** Confirmed absent + eligible to roll back, but awaiting manual action (auto off). */
  needsReview: number;
  /** Not actionable yet: too recent, or the scan didn't reach back to confirm absence. */
  stuck: number;
}

export async function reconcilePendingClaims(): Promise<ClaimReconcileResult> {
  await ready();
  const pending = await listPendingClaims(); // created_at ASC
  const zero: ClaimReconcileResult = { settled: 0, rolledBack: 0, needsReview: 0, stuck: 0 };
  if (pending.length === 0) return zero;

  const now = Date.now();
  const lookup = await findClaimPayouts(pending[0].createdAt);
  if (!lookup) {
    const stuck = pending.filter((c) => c.createdAt < now - STUCK_CLAIM_MS).length;
    if (stuck) {
      logError("reconcile.claims", new Error(`${stuck} pending claim(s) with no signature and no treasury configured to reconcile against`));
    }
    return { ...zero, stuck };
  }

  const res: ClaimReconcileResult = { settled: 0, rolledBack: 0, needsReview: 0, stuck: 0 };
  let scanCapped = 0;
  for (const c of pending) {
    const hit = lookup.found[c.id];
    if (hit) {
      await settleClaim(c.id, hit.sig, hit.cluster);
      res.settled++;
      continue;
    }
    const oldEnough = c.createdAt < now - SETTLE_GRACE_MS;
    const covered = lookup.coveredSince <= c.createdAt;
    if (oldEnough && covered) {
      // Confirmed absent on-chain.
      if (autoRollbackEnabled()) {
        await rollbackClaim(c.id);
        res.rolledBack++;
      } else {
        res.needsReview++;
        logError(
          "reconcile.claims",
          new Error(`claim ${c.id} (owner-scoped) appears UNPAID on-chain and is eligible to roll back — verify on the explorer and reconcile by hand, or set AEMULUS_CLAIM_AUTO_ROLLBACK=1`),
        );
      }
    } else if (oldEnough && !covered) {
      // Old, but the bounded scan didn't reach its window (busy treasury): absence
      // is NOT confirmed, so never roll back — signal it distinctly from "recent".
      res.stuck++;
      scanCapped++;
    } else {
      res.stuck++; // simply too recent — a payout could still be confirming
    }
  }
  if (res.settled || res.rolledBack) logInfo("reconcile.claims", "reconciled claims", { settled: res.settled, rolledBack: res.rolledBack });
  if (scanCapped) {
    logError("reconcile.claims", new Error(`${scanCapped} old pending claim(s) beyond the signature-scan window — raise AEMULUS_RECONCILE_MAX or reconcile manually`));
  }
  return res;
}

let running = false;

export interface ReconcileSummary {
  batch: number;
  registry: number;
  zk: number;
  claims: ClaimReconcileResult;
}

/** One reconciliation pass over all anchor types + claims (re-entrancy-guarded). */
export async function reconcileAnchors(): Promise<ReconcileSummary> {
  const empty: ReconcileSummary = { batch: 0, registry: 0, zk: 0, claims: { settled: 0, rolledBack: 0, needsReview: 0, stuck: 0 } };
  if (running) return empty;
  running = true;
  try {
    const batch = await reconcileBatchAnchors();
    const registry = await reconcileRegistryAnchors();
    const zk = await reconcileZkAnchors();
    const claims = await reconcilePendingClaims();
    if (batch || registry || zk) {
      logInfo("reconcile", "recovered anchors", { batch, registry, zk });
    }
    return { batch, registry, zk, claims };
  } finally {
    running = false;
  }
}

declare global {
  var __aemReconciler: ReturnType<typeof setInterval> | undefined;
}

/** Periodically reconcile lost anchor signatures AND pending claim payouts. Fully
 *  inert (never starts the interval) unless an anchor path OR payouts are configured,
 *  so pre-launch there is no wasted work. payoutsEnabled MUST be in this gate: the
 *  tick's reconcilePendingClaims is the ONLY thing that settles/rolls-back a claim
 *  whose payout broadcast but lost confirmation — omitting it stranded a creator's
 *  earnings forever when payouts were live but no receipt-anchor path was configured. */
export function startReconciler(): void {
  if (globalThis.__aemReconciler) return;
  if (!memoAnchorEnabled() && !registryEnabled() && !zkReceiptsEnabled() && !payoutsEnabled()) return;
  const ms = Math.max(30_000, Number(process.env.AEMULUS_RECONCILE_MS) || 5 * 60 * 1000);
  globalThis.__aemReconciler = setInterval(() => {
    reconcileAnchors().catch((e) => logError("reconcile.tick", e));
  }, ms);
  logInfo("reconciler", `started (${ms}ms)`);
}
