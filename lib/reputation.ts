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

// Short-lived aggregate cache so listings don't re-run SUM/AVG every render.
// Invalidated when a skill's ratings or runs change (single-instance; see E11
// for a shared store across instances).
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { rep: SkillReputation; exp: number }>();

/** Drop cached reputation for a skill (call when its runs/ratings change). */
export function invalidateReputation(skillId: string): void {
  cache.delete(skillId);
}

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
  invalidateReputation(input.skillId);
}

/** Reputation for many skills at once (for listings), cached per skill. */
export async function getReputationBatch(
  skillIds: string[],
): Promise<Map<string, SkillReputation>> {
  const map = new Map<string, SkillReputation>();
  if (skillIds.length === 0) return map;

  const now = Date.now();
  const misses: string[] = [];
  for (const sid of skillIds) {
    const c = cache.get(sid);
    // Return a COPY - never hand callers the cached object (a mutation would
    // poison the shared cache entry for every later request).
    if (c && c.exp > now) map.set(sid, { ...c.rep });
    else misses.push(sid);
  }
  if (misses.length === 0) return map;

  await ready();
  const ph = misses.map(() => "?").join(",");
  // Exclude the author's OWN runs from the public "N runs · X% success" trust
  // signal — otherwise an owner can self-inflate it by re-running their own skill on
  // cherry-picked inputs. This mirrors the run_count/earnings anti-gaming rule
  // (run-service.ts: credit only when skill.owner !== runner), which this aggregate
  // previously contradicted.
  const runs = await db.execute({
    sql: `SELECT r.skill_id AS skill_id,
                 COUNT(*) AS total,
                 SUM(CASE WHEN r.status='completed' THEN 1 ELSE 0 END) AS completed
          FROM runs r JOIN skills s ON s.id = r.skill_id
          WHERE r.skill_id IN (${ph}) AND r.owner <> s.owner
          GROUP BY r.skill_id`,
    args: misses,
  });
  const rates = await db.execute({
    sql: `SELECT skill_id, AVG(stars) AS avg, COUNT(*) AS n
          FROM ratings WHERE skill_id IN (${ph}) GROUP BY skill_id`,
    args: misses,
  });

  for (const sid of misses) map.set(sid, { ...EMPTY });
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
  // Cache an independent copy so the returned map and the cache never alias.
  for (const sid of misses)
    cache.set(sid, { rep: { ...map.get(sid)! }, exp: now + CACHE_TTL_MS });
  // Bound the cache: drop expired entries for skills that aren't re-requested,
  // so the Map doesn't grow with every distinct skill id ever browsed.
  if (cache.size > 256) {
    for (const [sid, c] of cache) if (c.exp <= now) cache.delete(sid);
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
