import { db, ready } from "./db";
import { id } from "./ids";
import { startRun } from "./run-service";
import type { BulkRun, Skill } from "./types";

/**
 * Bulk runs: execute one skill across many input rows ("the next hundred,
 * automatically"). Creates a parent bulk_run and fires a child run per row —
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
  await db.execute({
    sql: `INSERT INTO bulk_runs (id, owner, skill_id, total, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [bulkId, runner, skill.id, rows.length, now],
  });
  for (let i = 0; i < rows.length; i++) {
    await startRun({ skill, input: rows[i], runner, bulkId, rowIndex: i });
  }
  return {
    id: bulkId,
    owner: runner,
    skillId: skill.id,
    total: rows.length,
    createdAt: now,
  };
}
