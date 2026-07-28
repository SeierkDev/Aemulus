import { db, ready } from "./db";
import { id } from "./ids";
import { decryptJSON, encryptJSON } from "./encrypt";
import type { Cadence, Schedule } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INTERVAL: Record<string, number> = {
  hourly: HOUR,
  every6h: 6 * HOUR,
  every12h: 12 * HOUR,
  daily: DAY,
  weekly: 7 * DAY,
};
/** Fixed interval for a cadence (weekdays falls back to a day for display). */
export function cadenceMs(c: Cadence): number {
  return INTERVAL[c] ?? DAY;
}

const CADENCE_LABEL: Record<Cadence, string> = {
  hourly: "Every hour",
  every6h: "Every 6 hours",
  every12h: "Every 12 hours",
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every week",
};
export function cadenceLabel(c: Cadence): string {
  return CADENCE_LABEL[c] ?? c;
}

/** Next run timestamp after `from` - handles "weekdays" by skipping weekends. */
export function nextRunAfter(c: Cadence, from: number): number {
  if (c === "weekdays") {
    const d = new Date(from + DAY);
    const day = d.getDay(); // 0 = Sun, 6 = Sat
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return from + cadenceMs(c);
}

/** Richer shape the scheduler needs to actually run a due schedule. */
export interface ScheduleDue {
  id: string;
  owner: string;
  skillId: string;
  input: Record<string, string>;
  cadence: Cadence;
  level: number;
  tier: string;
  nextRunAt: number;
}

export async function createSchedule(input: {
  owner: string;
  skillId: string;
  input: Record<string, string>;
  cadence: Cadence;
  level: number;
  tier: string;
}): Promise<string> {
  await ready();
  const sid = id("sch");
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO schedules (id, owner, skill_id, input, cadence, level, tier, active, last_run_id, last_run_at, next_run_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)`,
    args: [
      sid,
      input.owner,
      input.skillId,
      encryptJSON(input.input),
      input.cadence,
      input.level,
      input.tier,
      nextRunAfter(input.cadence, now),
      now,
    ],
  });
  return sid;
}

/** Cap on active schedules per owner - bounds scheduler load / quota churn. */
export const MAX_ACTIVE_SCHEDULES = 25;
/** Cap on TOTAL (active + paused) schedules per owner. Paused rows are kept (they're
 *  re-activatable) so the active-only cap doesn't bound row growth — a create→pause
 *  loop would accumulate rows that the /schedules page then loads + decrypts. This
 *  bounds it at the source; freeing a slot needs a DELETE (not just a pause). */
export const MAX_TOTAL_SCHEDULES = 50;

/** How many active (running) schedules an owner currently has. */
export async function countActiveSchedules(owner: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM schedules WHERE owner = ? AND active = 1`,
    args: [owner],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/** Total schedules (active + paused) an owner has — for the row-growth cap. */
export async function countAllSchedules(owner: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM schedules WHERE owner = ?`,
    args: [owner],
  });
  return Number(r.rows[0]?.n ?? 0);
}

export async function listSchedules(owner: string, limit = 200): Promise<Schedule[]> {
  await ready();
  // Bound the list: each row AES-GCM-decrypts its stored input, so an unlimited SELECT
  // would make a heavy user's own server-rendered /schedules page do unbounded decrypt
  // work. The total-schedules cap already bounds rows; this is defense-in-depth.
  const r = await db.execute({
    sql: `SELECT sc.*, COALESCE(sk.name, sc.skill_id) AS skill_name
          FROM schedules sc LEFT JOIN skills sk ON sk.id = sc.skill_id
          WHERE sc.owner = ? ORDER BY sc.created_at DESC LIMIT ?`,
    args: [owner, Math.max(1, Math.min(1000, limit))],
  });
  return r.rows.map(rowToSchedule);
}

export async function setScheduleActive(
  scheduleId: string,
  owner: string,
  active: boolean,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE schedules SET active = ? WHERE id = ? AND owner = ?`,
    args: [active ? 1 : 0, scheduleId, owner],
  });
  return r.rowsAffected > 0;
}

export async function deleteSchedule(
  scheduleId: string,
  owner: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `DELETE FROM schedules WHERE id = ? AND owner = ?`,
    args: [scheduleId, owner],
  });
  return r.rowsAffected > 0;
}

/** Active schedules whose next_run_at has passed (for the scheduler tick). */
export async function dueSchedules(now: number): Promise<ScheduleDue[]> {
  await ready();
  const r = await db.execute({
    // Oldest-due first so a backlog drains fairly and the most-overdue schedules
    // aren't starved when more than the page size are due at once.
    sql: `SELECT * FROM schedules WHERE active = 1 AND next_run_at <= ?
          ORDER BY next_run_at ASC LIMIT 25`,
    args: [now],
  });
  return r.rows.map((row) => ({
    id: String(row.id),
    owner: String(row.owner),
    skillId: String(row.skill_id),
    input: decryptJSON<Record<string, string>>(
      row.input == null ? null : String(row.input),
      {},
    ),
    cadence: String(row.cadence) as Cadence,
    level: Number(row.level),
    tier: String(row.tier),
    nextRunAt: Number(row.next_run_at),
  }));
}

export async function markRan(
  scheduleId: string,
  runId: string,
  nextRunAt: number,
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE schedules SET last_run_id = ?, last_run_at = ?, next_run_at = ? WHERE id = ?`,
    args: [runId, Date.now(), nextRunAt, scheduleId],
  });
}

/**
 * Atomically claim a due schedule by advancing its next_run_at. Returns true
 * only for the caller that wins the race - so a restart's catch-up tick or a
 * second instance can't run the same firing twice. A claimed-but-failed run
 * (quota/error) simply waits for the next cadence, exactly like a skip.
 */
export async function claimSchedule(
  scheduleId: string,
  now: number,
  nextRunAt: number,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE schedules SET next_run_at = ?
          WHERE id = ? AND active = 1 AND next_run_at <= ?`,
    args: [nextRunAt, scheduleId, now],
  });
  return r.rowsAffected > 0;
}

/** Record that a claimed schedule ran (next_run_at was already advanced). */
export async function recordRun(
  scheduleId: string,
  runId: string,
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE schedules SET last_run_id = ?, last_run_at = ? WHERE id = ?`,
    args: [runId, Date.now(), scheduleId],
  });
}

/** Advance next_run_at without recording a run (e.g. skipped by quota). */
export async function bumpNextRun(
  scheduleId: string,
  nextRunAt: number,
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE schedules SET next_run_at = ? WHERE id = ?`,
    args: [nextRunAt, scheduleId],
  });
}

export async function deactivate(scheduleId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE schedules SET active = 0 WHERE id = ?`,
    args: [scheduleId],
  });
}

function rowToSchedule(row: Record<string, unknown>): Schedule {
  return {
    id: String(row.id),
    owner: String(row.owner),
    skillId: String(row.skill_id),
    skillName: String(row.skill_name ?? row.skill_id),
    input: decryptJSON<Record<string, string>>(
      row.input == null ? null : String(row.input),
      {},
    ),
    cadence: String(row.cadence) as Cadence,
    active: Number(row.active) === 1,
    lastRunId: row.last_run_id == null ? null : String(row.last_run_id),
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    nextRunAt: Number(row.next_run_at),
    createdAt: Number(row.created_at),
  };
}
