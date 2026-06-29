import { db, ready } from "./db";

/**
 * Creator analytics: how a creator's published skills perform over time.
 * Returns a 14-day daily series (runs, completed, earnings) plus window totals.
 * Complements the all-time earnings summary on the same page.
 */
export interface CreatorAnalytics {
  days: { label: string; runs: number; completed: number; earnings: number }[];
  windowRuns: number;
  windowSuccess: number; // 0..1
  windowEarnings: number;
}

const WINDOW = 14;

export async function getCreatorAnalytics(
  owner: string,
): Promise<CreatorAnalytics> {
  await ready();
  // Anchor each bucket at a real LOCAL midnight (not uniform +DAY), so a DST
  // transition inside the window can't misattribute runs or repeat/skip a label.
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: WINDOW }, (_, i) => {
    const d = new Date(today0);
    d.setDate(d.getDate() - (WINDOW - 1) + i);
    return { ts: d.getTime(), runs: 0, completed: 0, earnings: 0 };
  });
  const dayStart = buckets[0].ts;
  // Map a timestamp to its bucket by local-midnight boundaries.
  const idx = (ts: number): number => {
    for (let i = WINDOW - 1; i >= 0; i--) {
      if (ts >= buckets[i].ts) return i;
    }
    return -1;
  };

  const runs = await db.execute({
    sql: `SELECT created_at, status FROM runs
          WHERE skill_id IN (SELECT id FROM skills WHERE owner = ?)
            AND created_at >= ?`,
    args: [owner, dayStart],
  });
  for (const r of runs.rows) {
    const i = idx(Number(r.created_at));
    if (i >= 0 && i < WINDOW) {
      buckets[i].runs++;
      if (String(r.status) === "completed") buckets[i].completed++;
    }
  }

  const earnings = await db.execute({
    sql: `SELECT created_at, amount FROM earnings
          WHERE owner = ? AND created_at >= ?`,
    args: [owner, dayStart],
  });
  for (const e of earnings.rows) {
    const i = idx(Number(e.created_at));
    if (i >= 0 && i < WINDOW) buckets[i].earnings += Number(e.amount);
  }

  const windowRuns = buckets.reduce((a, b) => a + b.runs, 0);
  const windowCompleted = buckets.reduce((a, b) => a + b.completed, 0);
  const windowEarnings = buckets.reduce((a, b) => a + b.earnings, 0);

  return {
    days: buckets.map((b) => ({
      label: new Date(b.ts).toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
      }),
      runs: b.runs,
      completed: b.completed,
      earnings: b.earnings,
    })),
    windowRuns,
    windowSuccess: windowRuns > 0 ? windowCompleted / windowRuns : 0,
    windowEarnings,
  };
}
