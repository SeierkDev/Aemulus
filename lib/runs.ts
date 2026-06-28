import { db, ready } from "./db";
import { id } from "./ids";
import { decryptJSON, encryptJSON } from "./encrypt";
import type {
  ReceiptBatch,
  Run,
  RunOverrides,
  RunStatus,
  RunStepRecord,
} from "./types";

export async function createRun(input: {
  owner: string;
  skillId: string;
  input: Record<string, string>;
  overrides?: RunOverrides;
}): Promise<Run> {
  await ready();
  const now = Date.now();
  const run: Run = {
    id: id("run"),
    owner: input.owner,
    skillId: input.skillId,
    status: "running",
    input: input.input,
    overrides: input.overrides ?? {},
    result: null,
    error: null,
    receiptHash: null,
    receiptSig: null,
    receiptCluster: null,
    batchId: null,
    leafIndex: null,
    merkleProof: null,
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO runs (id, owner, skill_id, status, input, overrides, result, error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.owner,
      run.skillId,
      run.status,
      encryptJSON(run.input),
      JSON.stringify(run.overrides),
      null,
      null,
      now,
      now,
    ],
  });
  return run;
}

export async function addRunStep(step: RunStepRecord): Promise<void> {
  await ready();
  await db.execute({
    sql: `INSERT INTO run_steps (id, run_id, idx, intent, action, screenshot, confidence, flagged, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      step.id,
      step.runId,
      step.idx,
      step.intent,
      encryptJSON({
        type: step.action,
        selectorUsed: step.selectorUsed,
        value: step.value,
      }),
      step.screenshot,
      step.confidence,
      step.flagged ? 1 : 0,
      step.note,
      step.createdAt,
    ],
  });
}

export async function finishRun(
  runId: string,
  patch: { status: RunStatus; result?: string | null; error?: string | null },
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE runs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?`,
    args: [patch.status, patch.result ?? null, patch.error ?? null, Date.now(), runId],
  });
}

export async function getBatch(batchId: string): Promise<ReceiptBatch | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM receipt_batches WHERE id = ?`,
    args: [batchId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    merkleRoot: String(row.merkle_root),
    leafCount: Number(row.leaf_count),
    sig: row.sig == null ? null : String(row.sig),
    cluster: row.cluster == null ? null : String(row.cluster),
    createdAt: Number(row.created_at),
  };
}

/** Attach a run's Merkle proof + batch (and the batch's anchor) after batching. */
export async function setRunBatch(
  runId: string,
  b: {
    batchId: string;
    leafIndex: number;
    proof: unknown;
    sig: string | null;
    cluster: string | null;
  },
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE runs SET batch_id = ?, leaf_index = ?, merkle_proof = ?,
          receipt_sig = ?, receipt_cluster = ? WHERE id = ?`,
    args: [b.batchId, b.leafIndex, JSON.stringify(b.proof), b.sig, b.cluster, runId],
  });
}

/** Has this wallet actually run this skill? (gates who may rate it.) */
export async function hasRunSkill(
  owner: string,
  skillId: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `SELECT 1 FROM runs WHERE owner = ? AND skill_id = ? LIMIT 1`,
    args: [owner, skillId],
  });
  return r.rows.length > 0;
}

export async function updateReceipt(
  runId: string,
  receipt: { hash: string; sig: string | null; cluster: string | null },
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE runs SET receipt_hash = ?, receipt_sig = ?, receipt_cluster = ? WHERE id = ?`,
    args: [receipt.hash, receipt.sig, receipt.cluster, runId],
  });
}

export async function getRun(runId: string): Promise<Run | null> {
  await ready();
  const r = await db.execute({ sql: `SELECT * FROM runs WHERE id = ?`, args: [runId] });
  if (!r.rows[0]) return null;
  const steps = await db.execute({
    sql: `SELECT * FROM run_steps WHERE run_id = ? ORDER BY idx ASC`,
    args: [runId],
  });
  return rowToRun(r.rows[0], steps.rows.map(rowToStep));
}

/** How many runs this wallet has started since `sinceMs` (for quotas). */
export async function countRecentRuns(
  owner: string,
  sinceMs: number,
): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM runs WHERE owner = ? AND created_at >= ?`,
    args: [owner, sinceMs],
  });
  return Number(r.rows[0]?.n ?? 0);
}

export async function listRuns(owner: string): Promise<Run[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM runs WHERE owner = ? ORDER BY created_at DESC LIMIT 50`,
    args: [owner],
  });
  return r.rows.map((row) => rowToRun(row, []));
}

function rowToRun(row: Record<string, unknown>, steps: RunStepRecord[]): Run {
  return {
    id: String(row.id),
    owner: row.owner == null ? "" : String(row.owner),
    skillId: String(row.skill_id),
    status: String(row.status) as RunStatus,
    input: decryptJSON<Record<string, string>>(
      row.input == null ? null : String(row.input),
      {},
    ),
    overrides: JSON.parse(String(row.overrides || "{}")),
    result: row.result == null ? null : String(row.result),
    error: row.error == null ? null : String(row.error),
    receiptHash: row.receipt_hash == null ? null : String(row.receipt_hash),
    receiptSig: row.receipt_sig == null ? null : String(row.receipt_sig),
    receiptCluster:
      row.receipt_cluster == null ? null : String(row.receipt_cluster),
    batchId: row.batch_id == null ? null : String(row.batch_id),
    leafIndex: row.leaf_index == null ? null : Number(row.leaf_index),
    merkleProof:
      row.merkle_proof == null ? null : JSON.parse(String(row.merkle_proof)),
    steps,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStep(row: Record<string, unknown>): RunStepRecord {
  const action = decryptJSON<{
    type?: RunStepRecord["action"];
    selectorUsed?: string;
    value?: string;
  }>(row.action == null ? null : String(row.action), {});
  return {
    id: String(row.id),
    runId: String(row.run_id),
    idx: Number(row.idx),
    intent: String(row.intent),
    action: action.type ?? "click",
    selectorUsed: action.selectorUsed ?? "",
    value: action.value ?? "",
    screenshot: row.screenshot == null ? "" : String(row.screenshot),
    confidence: Number(row.confidence),
    flagged: Number(row.flagged) === 1,
    note: row.note == null ? "" : String(row.note),
    createdAt: Number(row.created_at),
  };
}
