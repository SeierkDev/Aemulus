import { db, ready } from "./db";
import { id } from "./ids";
import type { SkillReputation, SkillReview } from "./types";

/**
 * Skill trust signals. Outcome stats come from real runs (success rate = share
 * of runs that completed); ratings come from user stars/reviews. Together they
 * tell a marketplace browser "does this skill actually work?".
 */

const EMPTY: SkillReputation = {
  runs: 0,
  completed: 0,
  successRate: 0,
  avgStars: 0,
  ratingCount: 0,
};

/** Upsert a wallet's rating for a skill (one per wallet). */
export async function rateSkill(input: {
  skillId: string;
  rater: string;
  stars: number;
  comment: string;
}): Promise<void> {
  await ready();
  const stars = Math.max(1, Math.min(5, Math.round(input.stars)));
  await db.execute({
    sql: `INSERT INTO ratings (id, skill_id, rater, stars, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(skill_id, rater)
          DO UPDATE SET stars = excluded.stars, comment = excluded.comment, created_at = excluded.created_at`,
    args: [id("rat"), input.skillId, input.rater, stars, input.comment, Date.now()],
  });
}

/** Reputation for many skills at once (for listings). */
export async function getReputationBatch(
  skillIds: string[],
): Promise<Map<string, SkillReputation>> {
  const map = new Map<string, SkillReputation>();
  if (skillIds.length === 0) return map;
  await ready();
  const ph = skillIds.map(() => "?").join(",");

  const runs = await db.execute({
    sql: `SELECT skill_id,
                 COUNT(*) AS total,
                 SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
          FROM runs WHERE skill_id IN (${ph}) GROUP BY skill_id`,
    args: skillIds,
  });
  const rates = await db.execute({
    sql: `SELECT skill_id, AVG(stars) AS avg, COUNT(*) AS n
          FROM ratings WHERE skill_id IN (${ph}) GROUP BY skill_id`,
    args: skillIds,
  });

  for (const sid of skillIds) map.set(sid, { ...EMPTY });
  for (const r of runs.rows) {
    const total = Number(r.total);
    const completed = Number(r.completed);
    const rep = map.get(String(r.skill_id))!;
    rep.runs = total;
    rep.completed = completed;
    rep.successRate = total > 0 ? completed / total : 0;
  }
  for (const r of rates.rows) {
    const rep = map.get(String(r.skill_id))!;
    rep.avgStars = Number(r.avg) || 0;
    rep.ratingCount = Number(r.n);
  }
  return map;
}

export async function getSkillReputation(
  skillId: string,
): Promise<SkillReputation> {
  return (await getReputationBatch([skillId])).get(skillId) ?? { ...EMPTY };
}

/** A wallet's existing rating for a skill, if any (to prefill the widget). */
export async function getMyRating(
  skillId: string,
  rater: string,
): Promise<{ stars: number; comment: string } | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT stars, comment FROM ratings WHERE skill_id = ? AND rater = ?`,
    args: [skillId, rater],
  });
  const row = r.rows[0];
  return row
    ? { stars: Number(row.stars), comment: String(row.comment ?? "") }
    : null;
}

export async function listReviews(
  skillId: string,
  limit = 10,
): Promise<SkillReview[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT rater, stars, comment, created_at FROM ratings
          WHERE skill_id = ? AND comment != '' ORDER BY created_at DESC LIMIT ?`,
    args: [skillId, limit],
  });
  return r.rows.map((x) => ({
    rater: String(x.rater),
    stars: Number(x.stars),
    comment: String(x.comment),
    createdAt: Number(x.created_at),
  }));
}
