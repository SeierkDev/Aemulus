import { db, ready } from "./db";
import { id } from "./ids";
import { sendPayout, PayoutPrepError } from "./payout";
import { incr } from "./metrics";
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
  // Reject non-finite/non-positive amounts so a bad value can't poison SUM().
  if (!input.owner || !Number.isFinite(input.amount) || input.amount <= 0) return;
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

/**
 * Atomically credit the creator at most ONCE per (skill, runner). The
 * `WHERE NOT EXISTS` makes the gate-and-insert a single statement, so two
 * concurrent completed runs of the same skill by the same runner can't both
 * pass a separate check-then-insert and double-credit (SQLite serializes
 * writes). Returns true iff a credit row was actually written. This is the
 * anti-Sybil credit path used by completeRun.
 */
export async function creditEarningOnce(input: {
  owner: string;
  skillId: string;
  runId: string;
  runner: string;
  amount: number;
}): Promise<boolean> {
  await ready();
  if (!input.owner || !Number.isFinite(input.amount) || input.amount <= 0) return false;
  const r = await db.execute({
    sql: `INSERT INTO earnings (id, owner, skill_id, run_id, runner, amount, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM earnings WHERE skill_id = ? AND runner = ?)`,
    args: [
      id("earn"),
      input.owner,
      input.skillId,
      input.runId,
      input.runner,
      input.amount,
      Date.now(),
      input.skillId,
      input.runner,
    ],
  });
  return r.rowsAffected > 0;
}

/**
 * Has this runner ever earned the creator a credit for this skill? Used to
 * credit only the FIRST run per distinct (skill, runner) - anti-Sybil: farming
 * a creator's own skill from one burner wallet yields a single credit, and N
 * credits would require N separately-funded wallets (each gated on a min $AEMU
 * balance post-launch), making self-farming uneconomical.
 */
export async function hasEarnedFrom(
  skillId: string,
  runner: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `SELECT 1 FROM earnings WHERE skill_id = ? AND runner = ? LIMIT 1`,
    args: [skillId, runner],
  });
  return r.rows.length > 0;
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
 * records a claim, then pays out - rolling the marks back if the payout fails
 * (so funds are never lost or double-marked). `send` is injectable for tests.
 */
export async function claimEarnings(
  owner: string,
  send: Sender = sendPayout,
): Promise<ClaimResult> {
  await ready();
  const claimId = id("clm");
  const now = Date.now();

  // Atomically claim ALL of this owner's currently-unclaimed earnings. SQLite
  // serializes writes, so a concurrent claim sees 0 unclaimed rows and pays
  // nothing - no double-pay. We then read back exactly what we claimed.
  await db.execute({
    sql: `UPDATE earnings SET claim_id = ? WHERE owner = ? AND claim_id IS NULL`,
    args: [claimId, owner],
  });
  const sumRow = await db.execute({
    sql: `SELECT COALESCE(SUM(amount),0) AS total FROM earnings WHERE claim_id = ?`,
    args: [claimId],
  });
  const amount = Number(sumRow.rows[0]?.total ?? 0);
  if (amount <= 0) return { claimed: 0, sig: null, cluster: null };

  await db.execute({
    sql: `INSERT INTO claims (id, owner, amount, sig, cluster, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [claimId, owner, amount, null, null, now],
  });

  let res: Awaited<ReturnType<Sender>>;
  try {
    res = await send(owner, amount);
  } catch (e) {
    if (e instanceof PayoutPrepError) {
      // Nothing was broadcast (bad config / decimals mismatch / build error) →
      // fully roll back so the creator's earnings aren't locked as claimed.
      await db.execute({ sql: `UPDATE earnings SET claim_id = NULL WHERE claim_id = ?`, args: [claimId] });
      await db.execute({ sql: `DELETE FROM claims WHERE id = ?`, args: [claimId] });
      throw new Error(`Payout is misconfigured — no funds moved and your earnings are intact: ${e.message}`);
    }
    // The transfer may already have broadcast (e.g. confirm timed out). Do NOT
    // un-claim - that could cause a double payout. Leave the claim pending
    // (sig null) for reconciliation.
    throw new Error(
      e instanceof Error
        ? `Payout unconfirmed - claim left pending: ${e.message}`
        : "Payout unconfirmed - claim left pending.",
    );
  }
  if (!res) {
    // Payouts not configured → nothing was broadcast → safe to fully roll back.
    await db.execute({
      sql: `UPDATE earnings SET claim_id = NULL WHERE claim_id = ?`,
      args: [claimId],
    });
    await db.execute({ sql: `DELETE FROM claims WHERE id = ?`, args: [claimId] });
    throw new Error("Payouts are not enabled yet.");
  }
  await db.execute({
    sql: `UPDATE claims SET sig = ?, cluster = ? WHERE id = ?`,
    args: [res.sig, res.cluster, claimId],
  });
  incr("claims.settled");
  return { claimed: amount, sig: res.sig, cluster: res.cluster };
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
