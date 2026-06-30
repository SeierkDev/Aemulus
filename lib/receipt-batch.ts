import { db, ready } from "./db";
import { id } from "./ids";
import { setRunBatch } from "./runs";
import { buildMerkle, proofForIndex } from "./merkle";
import { anchorOnChain } from "./receipt";
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

/** Release runs that were claimed into a batch but never got an inclusion proof
 *  written (a crash between claim and persist) so they re-batch. Run at boot,
 *  when no tick is in flight, so it can't race a live batch. */
export async function recoverOrphanedBatchClaims(): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE runs SET batch_id = NULL
          WHERE batch_id IS NOT NULL AND merkle_proof IS NULL`,
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
      sql: `UPDATE runs SET batch_id = ?
            WHERE id IN (
              SELECT id FROM runs
              WHERE batch_id IS NULL AND receipt_hash IS NOT NULL
              ORDER BY created_at ASC, id ASC LIMIT ?
            )`,
      args: [batchId, max],
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

    logInfo("receipt.batch", batchId, {
      leaves: pending.length,
      anchored: !!anchored,
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
