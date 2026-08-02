import { db, ready } from "./db";
import { id } from "./ids";
import { setRunBatch } from "./runs";
import { buildMerkle, proofForIndex } from "./merkle";
import { anchorOnChain, buildBatchBundle, toArchiveBundle } from "./receipt";
import { arweaveEnabled, storeBundle } from "./arweave";
import { sweepShots } from "./shot-archive";
import { logError, logInfo } from "./log";

export { getBatch } from "./runs";

/**
 * Merkle-batch all pending run receipts: build one tree over their leaf hashes,
 * anchor the single root on-chain, and write each run its inclusion proof. This
 * turns "one transaction per run" into "one transaction per batch" - verifiable
 * autonomy that scales to millions of runs for pennies. Each run can still be
 * verified independently against the on-chain root via its proof.
 */
const ANCHOR_TIMEOUT_MS = 60_000;
let batching = false; // re-entrancy guard: never overlap two batch ticks

/** Bound the on-chain anchor so a hung RPC can't block the batcher tick forever
 *  (anchorOnChain itself has no timeout). A timeout yields an unanchored-but-
 *  valid batch, which the next tick / verify path handles. */
async function anchorWithTimeout(
  memo: string,
): Promise<{ sig: string; cluster: string } | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((res) => {
    t = setTimeout(() => res(null), ANCHOR_TIMEOUT_MS);
  });
  try {
    return await Promise.race([anchorOnChain(memo), timeout]);
  } finally {
    clearTimeout(t);
  }
}

// A claimed-but-unproven batch older than this is treated as crashed and reclaimable.
// MUST exceed the anchor timeout + persist time so it can never reclaim a LIVE batch
// (which sits claimed-but-unproven for up to ANCHOR_TIMEOUT_MS while anchoring).
const BATCH_STALE_MS = ANCHOR_TIMEOUT_MS + 4 * 60_000; // 5 min

/** Release runs that were claimed into a batch but never got an inclusion proof
 *  written (a crash between claim and persist) so they re-batch. Gated on staleness:
 *  a peer instance's LIVE batch (claimed-but-unproven while anchoring) has a recent
 *  `batched_at` and is NOT reclaimed — only genuinely-crashed claims older than
 *  BATCH_STALE_MS are. Without this age guard, a second instance booting mid-batch
 *  would wipe the first's in-flight batch (duplicate on-chain anchoring + phantom
 *  batch rows). */
export async function recoverOrphanedBatchClaims(now: number = Date.now()): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE runs SET batch_id = NULL
          WHERE batch_id IS NOT NULL AND merkle_proof IS NULL
            AND (batched_at IS NULL OR batched_at < ?)`,
    args: [now - BATCH_STALE_MS],
  });
  return r.rowsAffected;
}

export async function batchPendingReceipts(
  opts: { max?: number } = {},
): Promise<{
  batchId: string;
  leafCount: number;
  root: string;
  anchored: boolean;
} | null> {
  if (batching) return null; // a previous tick is still running
  batching = true;
  const max = opts.max ?? 1000;
  const batchId = id("batch");
  try {
    await ready();

    // Atomically claim a slice of unbatched receipts (concurrent-safe: a row is
    // claimed exactly once even if two batchers run). The id tiebreaker makes the
    // claim's ordering agree with the tree-build re-SELECT below.
    const claim = await db.execute({
      sql: `UPDATE runs SET batch_id = ?, batched_at = ?
            WHERE id IN (
              SELECT id FROM runs
              WHERE batch_id IS NULL AND receipt_hash IS NOT NULL
              ORDER BY created_at ASC, id ASC LIMIT ?
            )`,
      args: [batchId, Date.now(), max],
    });
    if (claim.rowsAffected === 0) return null;

    const rows = await db.execute({
      sql: `SELECT id, receipt_hash FROM runs WHERE batch_id = ?
            ORDER BY created_at ASC, id ASC`,
      args: [batchId],
    });
    const pending = rows.rows.map((x) => ({
      id: String(x.id),
      hash: String(x.receipt_hash),
    }));

    const tree = buildMerkle(pending.map((p) => p.hash));
    const anchored = await anchorWithTimeout(`aemulus:batch:${tree.root}`);

    try {
      await db.execute({
        sql: `INSERT INTO receipt_batches (id, merkle_root, leaf_count, sig, cluster, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          batchId,
          tree.root,
          pending.length,
          anchored?.sig ?? null,
          anchored?.cluster ?? null,
          Date.now(),
        ],
      });
      for (let i = 0; i < pending.length; i++) {
        await setRunBatch(pending[i].id, {
          batchId,
          leafIndex: i,
          proof: proofForIndex(tree, i),
          sig: anchored?.sig ?? null,
          cluster: anchored?.cluster ?? null,
        });
      }
    } catch (e) {
      // Persist failed partway: release any run that didn't get a proof so it
      // re-batches next tick (don't leave it claimed-but-unprovable forever).
      await db
        .execute({
          sql: `UPDATE runs SET batch_id = NULL WHERE batch_id = ? AND merkle_proof IS NULL`,
          args: [batchId],
        })
        .catch(() => {});
      throw e;
    }

    // Store the bundle permanently, AFTER the batch is safely persisted. The
    // batch is already valid and verifiable without this — permanence is an
    // addition to the proof, not a precondition for it — so nothing about
    // Arweave may hold up batching or lose a proof. storeBatch owns the whole
    // path including building the bundle, and cannot throw.
    const arweaveId = await storeBatch(batchId);
    // Pick up anything an earlier tick failed to store, so one bad upload does
    // not mean that batch is silently never permanent.
    void storeMissingBatches().catch(() => {});
    // Screenshots of runs their owners published. Separate switch, separate
    // budget: this one spends money and publishes pixels, so it never rides
    // along on the bundle setting.
    void sweepShots().catch(() => {});

    logInfo("receipt.batch", batchId, {
      leaves: pending.length,
      anchored: !!anchored,
      arweave: arweaveId ?? false,
    });
    return {
      batchId,
      leafCount: pending.length,
      root: tree.root,
      anchored: !!anchored,
    };
  } finally {
    batching = false;
  }
}

/**
 * How far back the retry sweep looks.
 *
 * Bounded on purpose, in both directions. Without an upper bound on age the
 * sweep walks the entire back-catalogue and silently uploads every batch that
 * predates the key ever being set — work nobody asked for. And a batch that can
 * never be stored (an oversized bundle fails identically every time) would sit
 * at the head of an unbounded newest-first sweep forever, blocking every batch
 * behind it. Ageing out is the better failure of the two: the work stays
 * bounded, and the gap is visible, because a batch with no Arweave link simply
 * doesn't show one on its receipt.
 */
const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Guards against overlapping sweeps, which would upload the same batch twice. */
let sweeping = false;

/**
 * Build, store and record a batch's bundle. Nothing here can throw: a batch is
 * already valid and verifiable offline without Arweave, so permanence is an
 * addition to the proof rather than a precondition for it, and no third party
 * may hold up batching.
 */
export async function storeBatch(batchId: string): Promise<string | null> {
  if (!arweaveEnabled()) return null;
  try {
    await ready();
    // Built inside the boundary: doing it at the call site put a database read
    // outside the try, where a blip threw straight out of batching.
    const full = await buildBatchBundle(batchId);
    // Stored WITHOUT the proofs. A full bundle for a large batch runs to about
    // a megabyte, far past the free tier, so storing that form meant every busy
    // batch was silently skipped — permanence quietly switching itself off
    // exactly when there were the most receipts to keep.
    const arweaveId = await storeBundle(batchId, full ? toArchiveBundle(full) : null);
    if (!arweaveId) return null;
    await db.execute({
      sql: `UPDATE receipt_batches SET arweave_id = ? WHERE id = ?`,
      args: [arweaveId, batchId],
    });
    return arweaveId;
  } catch (e) {
    logError("arweave.storeBatch", e, { batch: batchId });
    return null;
  }
}

/**
 * Re-attempt recent batches that were never stored, so a single failed upload
 * doesn't mean that batch is silently never permanent.
 */
export async function storeMissingBatches(limit = 5): Promise<number> {
  if (!arweaveEnabled() || sweeping) return 0;
  sweeping = true;
  try {
    await ready();
    const r = await db.execute({
      sql: `SELECT id FROM receipt_batches
            WHERE arweave_id IS NULL AND created_at >= ?
            ORDER BY created_at DESC LIMIT ?`,
      args: [Date.now() - SWEEP_WINDOW_MS, Math.max(1, Math.min(50, limit))],
    });
    let stored = 0;
    for (const row of r.rows) {
      if (await storeBatch(String(row.id))) stored++;
    }
    return stored;
  } catch (e) {
    logError("arweave.sweep", e);
    return 0;
  } finally {
    sweeping = false;
  }
}

declare global {
  var __aemBatcher: ReturnType<typeof setInterval> | undefined;
}

/** Periodically anchor pending receipts in Merkle batches. */
export function startBatcher(): void {
  if (globalThis.__aemBatcher) return;
  const ms = Math.max(5_000, Number(process.env.AEMULUS_BATCH_MS) || 30_000);
  // Release any runs a previous process claimed but crashed before proving.
  void recoverOrphanedBatchClaims()
    .then((n) => {
      if (n) logInfo("receipt.batch.recover", `released ${n} orphaned claim(s)`);
    })
    .catch((e) => logError("receipt.batch.recover", e));
  globalThis.__aemBatcher = setInterval(() => {
    batchPendingReceipts().catch((e) => logError("receipt.batch.tick", e));
  }, ms);
  logInfo("batcher", `started (${ms}ms)`);
}
