import { db, ready } from "./db";
import { id } from "./ids";
import { startRun, QuotaExceededError } from "./run-service";
import { logError } from "./log";
import type { QuotaReserve } from "./runs";
import type { BulkRun, Skill } from "./types";

/**
 * Bulk runs: execute one skill across many input rows ("the next hundred,
 * automatically"). Creates a parent bulk_run and fires a child run per row -
 * each runs in the background, bounded by the run-slot semaphore (so a 100-row
 * bulk drains a few at a time rather than launching 100 browsers at once).
 *
 * `reserve` (the caller's atomic daily-quota reservation) is applied to EACH
 * child so a bulk can't race the soft pre-check to blow past the daily cap;
 * rows refused by the reserve are counted as `skipped` and surfaced, not
 * silently dropped.
 */
export async function createBulkRun(
  skill: Skill,
  rows: Record<string, string>[],
  runner: string,
  reserve?: QuotaReserve,
): Promise<BulkRun & { skipped: number }> {
  await ready();
  const bulkId = id("bulk");
  const now = Date.now();
  // Start the child runs first, then record the parent total as the number we
  // actually started - so a mid-loop failure can't leave total > children
  // (which would make the bulk's progress never reach completion).
  let started = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await startRun({ skill, input: rows[i], runner, bulkId, rowIndex: i, quota: reserve });
      started++;
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        skipped++; // over the daily quota — an expected outcome, reported below
        continue;
      }
      logError("bulk.startRun", e);
    }
  }
  // Couldn't start a single row: surface WHY (all over quota vs an infra failure)
  // instead of recording a "successful" empty bulk.
  if (rows.length > 0 && started === 0) {
    throw new Error(
      skipped > 0
        ? `Bulk run failed: all ${skipped} rows would exceed your daily quota.`
        : "Bulk run failed: no child runs could be started.",
    );
  }
  await db.execute({
    sql: `INSERT INTO bulk_runs (id, owner, skill_id, total, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [bulkId, runner, skill.id, started, now],
  });
  return {
    id: bulkId,
    owner: runner,
    skillId: skill.id,
    total: started,
    createdAt: now,
    skipped,
  };
}
