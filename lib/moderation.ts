import { db, ready } from "./db";
import { id } from "./ids";
import { logInfo } from "./log";
import { incr } from "./metrics";

/**
 * Marketplace moderation. Anyone can report a published skill once; once a skill
 * collects enough distinct reports it is auto-unpublished (takedown) — no admin
 * needed. A configurable set of wallets is shown as "Verified".
 */
const VERIFIED = new Set(
  (process.env.AEMULUS_VERIFIED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const TAKEDOWN_AT = Math.max(1, Number(process.env.AEMULUS_REPORT_TAKEDOWN) || 3);

/** Is this creator a verified publisher (env-configured)? */
export function isVerified(owner: string): boolean {
  return VERIFIED.has(owner);
}

export async function countReports(skillId: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM skill_reports WHERE skill_id = ?`,
    args: [skillId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Record a report (one per wallet per skill — duplicates are ignored) and
 * auto-unpublish the skill once it reaches the takedown threshold.
 */
export async function reportSkill(
  skillId: string,
  reporter: string,
  reason: string,
): Promise<{ reports: number; tookDown: boolean }> {
  await ready();
  try {
    await db.execute({
      sql: `INSERT INTO skill_reports (id, skill_id, reporter, reason, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id("rep"), skillId, reporter, reason.slice(0, 500), Date.now()],
    });
    incr("reports.filed");
  } catch {
    // UNIQUE(skill_id, reporter) — this wallet already reported it; no-op.
  }
  const reports = await countReports(skillId);
  let tookDown = false;
  if (reports >= TAKEDOWN_AT) {
    const r = await db.execute({
      sql: `UPDATE skills SET published = 0, updated_at = ? WHERE id = ? AND published = 1`,
      args: [Date.now(), skillId],
    });
    tookDown = r.rowsAffected > 0;
    if (tookDown) {
      incr("reports.takedowns");
      logInfo("moderation.takedown", `skill ${skillId} auto-unpublished`, { reports });
    }
  }
  return { reports, tookDown };
}
