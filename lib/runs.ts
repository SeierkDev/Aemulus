import { db, ready } from "./db";
import { id } from "./ids";
import { decryptJSON, encryptJSON } from "./encrypt";
import { keysetClause, toPage, type Page } from "./pagination";
import type {
  BulkRun,
  ReceiptBatch,
  Run,
  RunOverrides,
  RunStatus,
  RunStepRecord,
} from "./types";

/** Parse JSON from a DB column without ever throwing out of a read path. */
function safeParse<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export async function createRun(input: {
  owner: string;
  skillId: string;
  input: Record<string, string>;
  overrides?: RunOverrides;
  bulkId?: string;
  rowIndex?: number;
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
    bulkId: input.bulkId ?? null,
    rowIndex: input.rowIndex ?? null,
    output: null,
    tokensIn: 0,
    tokensOut: 0,
    outcomeStatus: null,
    outcomeReason: null,
    commitmentRoot: null,
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO runs (id, owner, skill_id, status, input, overrides, result, error, bulk_id, row_index, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.owner,
      run.skillId,
      run.status,
      encryptJSON(run.input),
      JSON.stringify(run.overrides),
      null,
      null,
      run.bulkId,
      run.rowIndex,
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
  // Never move a run OUT of a terminal state. If a recovered/duplicate execution
  // tries to re-finish an already-settled run, this is a no-op (last-writer can't
  // clobber a real outcome).
  await db.execute({
    sql: `UPDATE runs SET status = ?, result = ?, error = ?, updated_at = ?
          WHERE id = ? AND status NOT IN ('completed','failed','needs_review')`,
    args: [patch.status, patch.result ?? null, patch.error ?? null, Date.now(), runId],
  });
}

/**
 * Atomically claim the post-run bookkeeping for a run. Returns true for exactly
 * ONE caller even if two executions of the same run race (a recovered duplicate),
 * so run_count / earnings / webhooks / metrics fire exactly once.
 */
export async function claimRunBookkeeping(runId: string): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE runs SET bookkept = 1 WHERE id = ? AND bookkept = 0`,
    args: [runId],
  });
  return r.rowsAffected > 0;
}

export async function getBulkRun(bulkId: string): Promise<BulkRun | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM bulk_runs WHERE id = ?`,
    args: [bulkId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    owner: String(row.owner),
    skillId: String(row.skill_id),
    total: Number(row.total),
    createdAt: Number(row.created_at),
  };
}

/** All child runs of a bulk run, in row order (input + output decrypted). */
export async function listRunsByBulk(bulkId: string): Promise<Run[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM runs WHERE bulk_id = ? ORDER BY row_index ASC`,
    args: [bulkId],
  });
  if (r.rows.length === 0) return [];
  // Fetch all steps for the batch in ONE query (was 1 + N), then group by run.
  const ids = r.rows.map((row) => String(row.id));
  const ph = ids.map(() => "?").join(",");
  const allSteps = await db.execute({
    sql: `SELECT * FROM run_steps WHERE run_id IN (${ph}) ORDER BY run_id, idx ASC`,
    args: ids,
  });
  const byRun = new Map<string, RunStepRecord[]>();
  for (const s of allSteps.rows) {
    const rid = String(s.run_id);
    let arr = byRun.get(rid);
    if (!arr) {
      arr = [];
      byRun.set(rid, arr);
    }
    arr.push(rowToStep(s));
  }
  return r.rows.map((row) => rowToRun(row, byRun.get(String(row.id)) ?? []));
}

/** Public, non-sensitive leaves of a batch: run id, leaf hash, index, proof. */
export async function listBatchLeaves(batchId: string): Promise<
  {
    runId: string;
    leafHash: string;
    leafIndex: number;
    proof: { siblings: { hash: string; left: boolean }[] };
  }[]
> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, receipt_hash, leaf_index, merkle_proof FROM runs
          WHERE batch_id = ? ORDER BY leaf_index ASC`,
    args: [batchId],
  });
  return r.rows.map((x) => ({
    runId: String(x.id),
    leafHash: x.receipt_hash == null ? "" : String(x.receipt_hash),
    leafIndex: x.leaf_index == null ? -1 : Number(x.leaf_index),
    proof: safeParse(x.merkle_proof, { siblings: [] }),
  }));
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

/** Persist values captured by "extract" steps during a run. */
export async function setRunOutput(
  runId: string,
  output: Record<string, string>,
): Promise<void> {
  if (Object.keys(output).length === 0) return;
  await ready();
  await db.execute({
    sql: `UPDATE runs SET output = ? WHERE id = ?`,
    args: [encryptJSON(output), runId],
  });
}

/** Set a run's status (e.g. running -> awaiting_input -> running). */
export async function setRunStatus(runId: string, status: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE runs SET status = ?, updated_at = ? WHERE id = ?`,
    args: [status, Date.now(), runId],
  });
}

/** Store a run's private-receipt commitment: public root + encrypted salts. */
export async function setRunCommitment(
  runId: string,
  root: string,
  salts: Record<string, string>,
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE runs SET commitment_root = ?, commitment_salts = ? WHERE id = ?`,
    args: [root, encryptJSON(salts), runId],
  });
}

/** The per-field salts for a run's commitment (owner-only; for disclosures). */
export async function getRunSalts(runId: string): Promise<Record<string, string>> {
  await ready();
  const r = await db.execute({
    sql: `SELECT commitment_salts FROM runs WHERE id = ?`,
    args: [runId],
  });
  const raw = r.rows[0]?.commitment_salts;
  return decryptJSON<Record<string, string>>(raw == null ? null : String(raw), {});
}

/** Record the vision success-verification verdict for a run. */
export async function setRunOutcome(
  runId: string,
  status: "achieved" | "unconfirmed",
  reason: string,
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE runs SET outcome_status = ?, outcome_reason = ? WHERE id = ?`,
    args: [status, reason.slice(0, 500), runId],
  });
}

/** Record operator (Claude) token usage for a run - cost transparency. */
export async function setRunUsage(
  runId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  if (tokensIn === 0 && tokensOut === 0) return;
  await ready();
  await db.execute({
    sql: `UPDATE runs SET tokens_in = ?, tokens_out = ? WHERE id = ?`,
    args: [tokensIn, tokensOut, runId],
  });
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

/** A caller's runs, cursor-paginated (newest first) for the public API. */
export async function listRunsPage(
  owner: string,
  limit: number,
  cursor: { createdAt: number; id: string } | null,
): Promise<Page<Run>> {
  await ready();
  const { clause, args } = keysetClause(cursor);
  const where = `owner = ?${clause ? ` AND ${clause}` : ""}`;
  const r = await db.execute({
    sql: `SELECT * FROM runs WHERE ${where}
          ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [owner, ...args, limit + 1],
  });
  return toPage(
    r.rows.map((row) => rowToRun(row, [])),
    limit,
    (run) => ({ createdAt: run.createdAt, id: run.id }),
  );
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
    overrides: safeParse<RunOverrides>(row.overrides, {}),
    result: row.result == null ? null : String(row.result),
    error: row.error == null ? null : String(row.error),
    receiptHash: row.receipt_hash == null ? null : String(row.receipt_hash),
    receiptSig: row.receipt_sig == null ? null : String(row.receipt_sig),
    receiptCluster:
      row.receipt_cluster == null ? null : String(row.receipt_cluster),
    batchId: row.batch_id == null ? null : String(row.batch_id),
    leafIndex: row.leaf_index == null ? null : Number(row.leaf_index),
    merkleProof: safeParse(row.merkle_proof, null),
    bulkId: row.bulk_id == null ? null : String(row.bulk_id),
    rowIndex: row.row_index == null ? null : Number(row.row_index),
    output:
      row.output == null
        ? null
        : decryptJSON<Record<string, string>>(String(row.output), {}),
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    outcomeStatus:
      row.outcome_status == null
        ? null
        : (String(row.outcome_status) as "achieved" | "unconfirmed"),
    outcomeReason: row.outcome_reason == null ? null : String(row.outcome_reason),
    commitmentRoot: row.commitment_root == null ? null : String(row.commitment_root),
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
    confidence: row.confidence == null ? 0 : Number(row.confidence),
    flagged: Number(row.flagged) === 1,
    note: row.note == null ? "" : String(row.note),
    createdAt: Number(row.created_at),
  };
}
