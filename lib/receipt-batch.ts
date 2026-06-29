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
export async function batchPendingReceipts(
  opts: { max?: number } = {},
): Promise<{
  batchId: string;
  leafCount: number;
  root: string;
  anchored: boolean;
} | null> {
  const max = opts.max ?? 1000;
  const batchId = id("batch");
  await ready();

  // Atomically claim a slice of unbatched receipts (concurrent-safe: a row is
  // claimed exactly once even if two batchers run - same pattern as the
  // scheduler). Only the rows we actually win form this batch's tree.
  const claim = await db.execute({
    sql: `UPDATE runs SET batch_id = ?
          WHERE id IN (
            SELECT id FROM runs
            WHERE batch_id IS NULL AND receipt_hash IS NOT NULL
            ORDER BY created_at ASC LIMIT ?
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
  const anchored = await anchorOnChain(`aemulus:batch:${tree.root}`);

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
}

declare global {
  var __aemBatcher: ReturnType<typeof setInterval> | undefined;
}

/** Periodically anchor pending receipts in Merkle batches. */
export function startBatcher(): void {
  if (globalThis.__aemBatcher) return;
  const ms = Math.max(5_000, Number(process.env.AEMULUS_BATCH_MS) || 30_000);
  globalThis.__aemBatcher = setInterval(() => {
    batchPendingReceipts().catch((e) => logError("receipt.batch.tick", e));
  }, ms);
  logInfo("batcher", `started (${ms}ms)`);
}
