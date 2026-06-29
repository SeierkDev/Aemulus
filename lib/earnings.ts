import { db, ready } from "./db";
import { id } from "./ids";
import { sendPayout } from "./payout";
import type { EarningsSummary } from "./types";

/**
 * Creator earnings ledger. Each external run of a published skill credits its
 * creator a per-run fee in $AEMU (off-chain accrual). A claim settles all of a
 * creator's unclaimed earnings on-chain via the treasury (see lib/payout).
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

/** Unclaimed accrued balance (what a "Claim" would settle). */
export async function getClaimable(owner: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COALESCE(SUM(amount),0) AS total FROM earnings
          WHERE owner = ? AND claim_id IS NULL`,
    args: [owner],
  });
  return Number(r.rows[0]?.total ?? 0);
}

export interface ClaimResult {
  claimed: number;
  sig: string | null;
  cluster: string | null;
}

type Sender = typeof sendPayout;

/**
 * Settle a creator's unclaimed earnings. Marks the exact rows as claimed,
 * records a claim, then pays out — rolling the marks back if the payout fails
 * (so funds are never lost or double-marked). `send` is injectable for tests.
 */
export async function claimEarnings(
  owner: string,
  send: Sender = sendPayout,
): Promise<ClaimResult> {
  await ready();
  const rows = await db.execute({
    sql: `SELECT id, amount FROM earnings WHERE owner = ? AND claim_id IS NULL`,
    args: [owner],
  });
  const ids = rows.rows.map((r) => String(r.id));
  const amount = rows.rows.reduce((a, r) => a + Number(r.amount), 0);
  if (ids.length === 0 || amount <= 0) {
    return { claimed: 0, sig: null, cluster: null };
  }

  const claimId = id("clm");
  const now = Date.now();
  const ph = ids.map(() => "?").join(",");
  // Claim exactly these rows (anything credited after stays unclaimed).
  await db.execute({
    sql: `UPDATE earnings SET claim_id = ? WHERE id IN (${ph}) AND claim_id IS NULL`,
    args: [claimId, ...ids],
  });
  await db.execute({
    sql: `INSERT INTO claims (id, owner, amount, sig, cluster, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [claimId, owner, amount, null, null, now],
  });

  try {
    const res = await send(owner, amount);
    if (!res) throw new Error("Payouts are not enabled yet.");
    await db.execute({
      sql: `UPDATE claims SET sig = ?, cluster = ? WHERE id = ?`,
      args: [res.sig, res.cluster, claimId],
    });
    return { claimed: amount, sig: res.sig, cluster: res.cluster };
  } catch (e) {
    // Roll back: un-claim the rows + drop the pending claim.
    await db.execute({
      sql: `UPDATE earnings SET claim_id = NULL WHERE claim_id = ?`,
      args: [claimId],
    });
    await db.execute({ sql: `DELETE FROM claims WHERE id = ?`, args: [claimId] });
    throw e;
  }
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
