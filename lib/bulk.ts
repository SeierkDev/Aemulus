import { db, ready } from "./db";
import { id } from "./ids";
import { startRun } from "./run-service";
import { logError } from "./log";
import type { BulkRun, Skill } from "./types";

/**
 * Bulk runs: execute one skill across many input rows ("the next hundred,
 * automatically"). Creates a parent bulk_run and fires a child run per row -
 * each runs in the background, bounded by the run-slot semaphore (so a 100-row
 * bulk drains a few at a time rather than launching 100 browsers at once).
 */
export async function createBulkRun(
  skill: Skill,
  rows: Record<string, string>[],
  runner: string,
): Promise<BulkRun> {
  await ready();
  const bulkId = id("bulk");
  const now = Date.now();
  // Start the child runs first, then record the parent total as the number we
  // actually started - so a mid-loop failure can't leave total > children
  // (which would make the bulk's progress never reach completion).
  let started = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await startRun({ skill, input: rows[i], runner, bulkId, rowIndex: i });
      started++;
    } catch (e) {
      logError("bulk.startRun", e);
    }
  }
  // If we were given rows but couldn't start a single one (e.g. the DB/queue is
  // down), don't report a "successful" empty bulk — surface the failure.
  if (rows.length > 0 && started === 0) {
    throw new Error("Bulk run failed: no child runs could be started.");
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
  };
}
