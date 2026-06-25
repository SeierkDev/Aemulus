import { db, ready } from "./db";
import { id } from "./ids";
import type { Run, RunOverrides, RunStatus, RunStepRecord } from "./types";

export async function createRun(input: {
  skillId: string;
  input: Record<string, string>;
  overrides?: RunOverrides;
}): Promise<Run> {
  await ready();
  const now = Date.now();
  const run: Run = {
    id: id("run"),
    skillId: input.skillId,
    status: "running",
    input: input.input,
    overrides: input.overrides ?? {},
    result: null,
    error: null,
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO runs (id, skill_id, status, input, overrides, result, error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.skillId,
      run.status,
      JSON.stringify(run.input),
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
      JSON.stringify({
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

export async function listRuns(): Promise<Run[]> {
  await ready();
  const r = await db.execute(`SELECT * FROM runs ORDER BY created_at DESC LIMIT 50`);
  return r.rows.map((row) => rowToRun(row, []));
}

function rowToRun(row: Record<string, unknown>, steps: RunStepRecord[]): Run {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    status: String(row.status) as RunStatus,
    input: JSON.parse(String(row.input || "{}")),
    overrides: JSON.parse(String(row.overrides || "{}")),
    result: row.result == null ? null : String(row.result),
    error: row.error == null ? null : String(row.error),
    steps,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStep(row: Record<string, unknown>): RunStepRecord {
  const action = JSON.parse(String(row.action || "{}"));
  return {
    id: String(row.id),
    runId: String(row.run_id),
    idx: Number(row.idx),
    intent: String(row.intent),
    action: action.type,
    selectorUsed: action.selectorUsed ?? "",
    value: action.value ?? "",
    screenshot: row.screenshot == null ? "" : String(row.screenshot),
    confidence: Number(row.confidence),
    flagged: Number(row.flagged) === 1,
    note: row.note == null ? "" : String(row.note),
    createdAt: Number(row.created_at),
  };
}
