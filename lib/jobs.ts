import { db, ready } from "./db";
import { id } from "./ids";
import { decryptJSON, encryptJSON } from "./encrypt";
import { incr } from "./metrics";
import type { RunOverrides } from "./types";

/**
 * Durable job queue for run execution. startRun enqueues a job; a worker
 * (lib/worker) claims jobs atomically, runs them, and retries transient
 * failures with backoff. This is what makes runs survive a restart and lets a
 * second instance share the load.
 */
export interface Job {
  id: string;
  runId: string;
  runner: string;
  skillId: string;
  input: Record<string, string>;
  overrides: RunOverrides;
  attempts: number;
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    runner: String(row.runner),
    skillId: String(row.skill_id),
    input: decryptJSON<Record<string, string>>(
      row.input == null ? null : String(row.input),
      {},
    ),
    overrides: decryptJSON<RunOverrides>(
      row.overrides == null ? null : String(row.overrides),
      {},
    ),
    attempts: Number(row.attempts ?? 0),
  };
}

export async function enqueueRunJob(j: {
  runId: string;
  runner: string;
  skillId: string;
  input: Record<string, string>;
  overrides?: RunOverrides;
}): Promise<string> {
  await ready();
  const jid = id("job");
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO jobs (id, run_id, runner, skill_id, input, overrides, status, attempts, run_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    args: [
      jid,
      j.runId,
      j.runner,
      j.skillId,
      encryptJSON(j.input),
      encryptJSON(j.overrides ?? {}),
      now,
      now,
    ],
  });
  incr("jobs.enqueued");
  return jid;
}

/**
 * Atomically claim the next eligible job (status=queued, run_at<=now). Returns
 * null if none. The UPDATE ... WHERE status='queued' makes the claim a race
 * winner - a concurrent worker that loses retries the next candidate.
 */
export async function claimNextJob(now: number = Date.now()): Promise<Job | null> {
  await ready();
  for (let i = 0; i < 5; i++) {
    const cand = await db.execute({
      sql: `SELECT id FROM jobs WHERE status = 'queued' AND run_at <= ?
            ORDER BY run_at ASC, created_at ASC LIMIT 1`,
      args: [now],
    });
    const cid = cand.rows[0]?.id;
    if (!cid) return null;
    const upd = await db.execute({
      sql: `UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1
            WHERE id = ? AND status = 'queued'`,
      args: [now, String(cid)],
    });
    if (upd.rowsAffected > 0) {
      const r = await db.execute({ sql: `SELECT * FROM jobs WHERE id = ?`, args: [String(cid)] });
      return rowToJob(r.rows[0]);
    }
    // lost the race - try the next candidate
  }
  return null;
}

export async function completeJob(jobId: string): Promise<void> {
  await ready();
  await db.execute({ sql: `UPDATE jobs SET status = 'done' WHERE id = ?`, args: [jobId] });
}

/**
 * Record a failed attempt. Re-queues with exponential backoff while attempts <
 * maxAttempts (returns true); otherwise marks the job permanently failed
 * (returns false). `attempts` was already incremented at claim time.
 */
export async function failJob(
  jobId: string,
  error: string,
  maxAttempts = 3,
): Promise<boolean> {
  await ready();
  const r = await db.execute({ sql: `SELECT attempts FROM jobs WHERE id = ?`, args: [jobId] });
  const attempts = Number(r.rows[0]?.attempts ?? maxAttempts);
  if (attempts < maxAttempts) {
    const backoff = Math.min(60_000, 1000 * 2 ** (attempts - 1)); // 1s, 2s, 4s…
    await db.execute({
      sql: `UPDATE jobs SET status = 'queued', run_at = ?, last_error = ? WHERE id = ?`,
      args: [Date.now() + backoff, error.slice(0, 500), jobId],
    });
    return true;
  }
  await db.execute({
    sql: `UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?`,
    args: [error.slice(0, 500), jobId],
  });
  return false;
}

/**
 * Re-queue jobs stuck in 'running' beyond `staleMs` - their worker/process died
 * mid-run. Run on a schedule + at boot so a crash doesn't strand a run forever.
 */
export async function recoverStuckJobs(
  now: number = Date.now(),
  staleMs = 10 * 60_000,
): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE jobs SET status = 'queued', run_at = ?
          WHERE status = 'running' AND locked_at < ?`,
    args: [now, now - staleMs],
  });
  return r.rowsAffected;
}

/** Queue-depth snapshot for /api/health. */
export async function jobCounts(): Promise<Record<string, number>> {
  await ready();
  const r = await db.execute(
    `SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`,
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[String(row.status)] = Number(row.n);
  return out;
}
