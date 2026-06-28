import { db, ready } from "./db";
import { id } from "./ids";
import type { EarningsSummary } from "./types";

/**
 * Creator earnings ledger. Each external run of a published skill credits its
 * creator a per-run fee in $AEMU. Pre-launch this is an off-chain accrual
 * balance; on-chain settlement (claim/payout) is a later step.
 */
export async function creditEarning(input: {
  owner: string;
  skillId: string;
  runId: string;
  runner: string;
  amount: number;
}): Promise<void> {
  await ready();
  if (!input.owner || input.amount <= 0) return;
  await db.execute({
    sql: `INSERT INTO earnings (id, owner, skill_id, run_id, runner, amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id("earn"),
      input.owner,
      input.skillId,
      input.runId,
      input.runner,
      input.amount,
      Date.now(),
    ],
  });
}

export async function getEarningsSummary(
  owner: string,
): Promise<EarningsSummary> {
  await ready();
  const totals = await db.execute({
    sql: `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS runs
          FROM earnings WHERE owner = ?`,
    args: [owner],
  });
  const bySkill = await db.execute({
    sql: `SELECT e.skill_id, COALESCE(s.name, e.skill_id) AS name,
                 SUM(e.amount) AS total, COUNT(*) AS runs
          FROM earnings e LEFT JOIN skills s ON s.id = e.skill_id
          WHERE e.owner = ? GROUP BY e.skill_id ORDER BY total DESC`,
    args: [owner],
  });
  const recent = await db.execute({
    sql: `SELECT e.skill_id, COALESCE(s.name, e.skill_id) AS name,
                 e.amount, e.created_at
          FROM earnings e LEFT JOIN skills s ON s.id = e.skill_id
          WHERE e.owner = ? ORDER BY e.created_at DESC LIMIT 20`,
    args: [owner],
  });
  return {
    total: Number(totals.rows[0]?.total ?? 0),
    runs: Number(totals.rows[0]?.runs ?? 0),
    bySkill: bySkill.rows.map((r) => ({
      skillId: String(r.skill_id),
      name: String(r.name),
      total: Number(r.total),
      runs: Number(r.runs),
    })),
    recent: recent.rows.map((r) => ({
      skillId: String(r.skill_id),
      name: String(r.name),
      amount: Number(r.amount),
      createdAt: Number(r.created_at),
    })),
  };
}
