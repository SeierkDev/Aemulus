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

  // Count only runs that actually earned this creator (a paid run), so the
  // "Runs" and "$AEMU" series stay consistent — both reflect real income, not
  // marketplace activity the creator wasn't paid for.
  const runs = await db.execute({
    sql: `SELECT r.created_at, r.status FROM runs r
          WHERE r.skill_id IN (SELECT id FROM skills WHERE owner = ?)
            AND r.created_at >= ?
            AND EXISTS (SELECT 1 FROM earnings e WHERE e.run_id = r.id)`,
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

/* ── per-skill ───────────────────────────────────────────────────────────── */

/**
 * What one published skill actually does once other people run it.
 *
 * The number that matters is the success rate, not the total. A run count says
 * a skill was used; a success rate says it worked. A skill that runs a hundred
 * times and fails a third of them is telling its author the page changed, and
 * the author is the only person who can fix it.
 *
 * Counts only. A skill's runs belong to the people who ran them, so the creator
 * sees how many distinct wallets used it and never which ones.
 */
export const MAX_DAYS = 90;

export interface DayPoint {
  ts: number;
  label: string;
  ok: number;
  failed: number;
  needsReview: number;
  /** Completed over everything that finished that day, or null on a quiet day. */
  rate: number | null;
}

export interface StepStop {
  idx: number;
  intent: string;
  stops: number;
}

export interface VersionRate {
  /** null = ran before versions were recorded. Reported, never guessed at. */
  version: number | null;
  runs: number;
  succeeded: number;
  rate: number | null;
}

export interface SkillAnalytics {
  skillId: string;
  days: number;
  /** Everything that reached a verdict. In-flight runs are excluded. */
  runs: number;
  succeeded: number;
  /** Hard failures only. A run that stopped to ask a human is counted below. */
  failed: number;
  /** Stopped and asked for a person. A different problem from a failure. */
  needsReview: number;
  /** Still queued or running. Never counted against the rate. */
  inFlight: number;
  /** 0..1, or null when nothing ran. A rate over zero runs is unknown, not 0%. */
  successRate: number | null;
  uniqueUsers: number;
  /** $AEMU accrued inside the window. Moves when the window changes. */
  earned: number;
  /**
   * Unclaimed $AEMU for this skill, ALL TIME and deliberately not windowed: a
   * claim settles everything outstanding, so a windowed figure would be a number
   * nobody can act on. It can legitimately exceed `earned` on a short window,
   * which is why the UI labels both.
   */
  claimable: number;
  /** Operator tokens spent running it, so cost is visible next to income. */
  tokensIn: number;
  tokensOut: number;
  /** Wallets that came back for a second run: did it turn out to be useful? */
  repeatUsers: number;
  /** Where runs that did not complete got to. Attribution is by the last step
   *  reached, which is where it stopped, not necessarily what is wrong. */
  stops: StepStop[];
  byVersion: VersionRate[];
  /** True when more distinct stopping points exist than the list shows. A cap
   *  nobody is told about reads as "these are all of them". */
  stopsTruncated: boolean;
  series: DayPoint[];
  /** The same window immediately before, so a number reads as a direction. */
  previous: { runs: number; successRate: number | null };
}

/** Clamp the window whatever a caller passes in. */
export function windowDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.max(7, Math.min(MAX_DAYS, Math.round(n)));
}

/** A run counts as succeeded only when it completed. */
const OK = "completed";
/** Stopped and asked a person. Not a success, and not the same as broken. */
const REVIEW = "needs_review";
/**
 * Still going. Excluded from every rate: a run that started ten seconds ago has
 * not failed, and counting it as one made a busy skill look like it was
 * collapsing whenever the page was opened mid-run.
 */
const INFLIGHT = ["queued", "running"];

export async function getSkillAnalytics(
  skillId: string,
  days = 30,
): Promise<SkillAnalytics> {
  await ready();
  const win = windowDays(days);

  // Local-midnight buckets, same as the creator series above: a uniform +24h
  // step would misattribute runs across a DST change and repeat or skip a label.
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: win }, (_, i) => {
    const d = new Date(today0);
    d.setDate(d.getDate() - (win - 1) + i);
    return { ts: d.getTime(), ok: 0, failed: 0, review: 0 };
  });
  const since = buckets[0].ts;
  const prevSince = since - win * 24 * 60 * 60 * 1000;
  const idx = (ts: number): number => {
    for (let i = win - 1; i >= 0; i--) if (ts >= buckets[i].ts) return i;
    return -1;
  };

  const totals = await db.execute({
    sql: `SELECT COUNT(*) AS all_runs,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS ok,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS review,
                 SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS inflight,
                 -- Settled runs only, so this can never disagree with the run
                 -- count sitting next to it on screen.
                 COUNT(DISTINCT CASE WHEN status NOT IN (?, ?) THEN owner END) AS users,
                 COALESCE(SUM(tokens_in), 0) AS tin,
                 COALESCE(SUM(tokens_out), 0) AS tout
          FROM runs WHERE skill_id = ? AND created_at >= ?`,
    args: [OK, REVIEW, INFLIGHT[0], INFLIGHT[1], INFLIGHT[0], INFLIGHT[1], skillId, since],
  });
  const t = totals.rows[0];
  const inFlight = Number(t?.inflight ?? 0);
  const runs = Number(t?.all_runs ?? 0) - inFlight;
  const succeeded = Number(t?.ok ?? 0);
  const needsReview = Number(t?.review ?? 0);

  const prev = await db.execute({
    sql: `SELECT COUNT(*) AS all_runs,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS ok,
                 SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS inflight
          FROM runs WHERE skill_id = ? AND created_at >= ? AND created_at < ?`,
    args: [OK, INFLIGHT[0], INFLIGHT[1], skillId, prevSince, since],
  });
  const p = prev.rows[0];
  const prevRuns = Number(p?.all_runs ?? 0) - Number(p?.inflight ?? 0);

  // Two columns only, but this DOES read every run in the window into memory to
  // bucket it. That is the price of local-midnight buckets: a GROUP BY in SQL
  // can only group on fixed arithmetic, and a fixed +24h step misattributes runs
  // across a DST change. Bounded by the 90-day cap and by this being one owner
  // looking at one skill.
  const rows = await db.execute({
    sql: `SELECT created_at, status FROM runs WHERE skill_id = ? AND created_at >= ?`,
    args: [skillId, since],
  });
  for (const r of rows.rows) {
    const i = idx(Number(r.created_at));
    if (i < 0) continue;
    const st = String(r.status);
    if (INFLIGHT.includes(st)) continue; // no verdict yet
    if (st === OK) buckets[i].ok++;
    else if (st === REVIEW) buckets[i].review++;
    else buckets[i].failed++;
  }

  // Came back for a second run. One-time curiosity and actual usefulness look
  // identical in a unique-user count.
  const repeat = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT owner FROM runs
            WHERE skill_id = ? AND created_at >= ? AND status NOT IN (?, ?)
            GROUP BY owner HAVING COUNT(*) > 1
          )`,
    args: [skillId, since, INFLIGHT[0], INFLIGHT[1]],
  });

  // Where runs that did not complete got to. Attributed to the LAST step the run
  // reached, which is where it stopped — honest phrasing, because the step that
  // stops is not always the step that is wrong.
  // LEFT JOIN on purpose. An inner join silently dropped every run that failed
  // before a single step executed — the page never loaded, the host was blocked,
  // the browser would not start — which is the most common failure there is and
  // the one an author most needs to see. Those come back as idx -1.
  const stops = await db.execute({
    sql: `SELECT COALESCE(s.idx, -1) AS idx,
                 COALESCE(s.intent, '') AS intent,
                 COUNT(*) AS stops
          FROM runs r
          LEFT JOIN run_steps s
            ON s.run_id = r.id
           AND s.idx = (SELECT MAX(idx) FROM run_steps WHERE run_id = r.id)
          WHERE r.skill_id = ? AND r.created_at >= ?
            AND r.status NOT IN (?, ?, ?)
          GROUP BY idx, intent
          ORDER BY stops DESC, idx ASC
          -- One more than we show, purely to know whether to say "and others".
          LIMIT 6`,
    args: [skillId, since, OK, INFLIGHT[0], INFLIGHT[1]],
  });

  // Per version, so a drop can be tied to the edit that caused it. Runs from
  // before version stamping report as null rather than being folded into v1.
  const versions = await db.execute({
    sql: `SELECT skill_version AS v,
                 COUNT(*) AS runs,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS ok
          FROM runs
          WHERE skill_id = ? AND created_at >= ? AND status NOT IN (?, ?)
          GROUP BY skill_version
          ORDER BY v DESC`,
    args: [OK, skillId, since, INFLIGHT[0], INFLIGHT[1]],
  });

  const money = await db.execute({
    sql: `SELECT COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS earned,
                 COALESCE(SUM(CASE WHEN claim_id IS NULL THEN amount ELSE 0 END), 0) AS claimable
          FROM earnings WHERE skill_id = ?`,
    args: [since, skillId],
  });
  const m = money.rows[0];

  return {
    skillId,
    days: win,
    runs,
    succeeded,
    failed: runs - succeeded - needsReview,
    needsReview,
    inFlight,
    successRate: runs > 0 ? succeeded / runs : null,
    uniqueUsers: Number(t?.users ?? 0),
    earned: Number(m?.earned ?? 0),
    claimable: Number(m?.claimable ?? 0),
    tokensIn: Number(t?.tin ?? 0),
    tokensOut: Number(t?.tout ?? 0),
    repeatUsers: Number(repeat.rows[0]?.n ?? 0),
    stops: stops.rows.slice(0, 5).map((r) => ({
      idx: Number(r.idx),
      intent: String(r.intent ?? ""),
      stops: Number(r.stops ?? 0),
    })),
    stopsTruncated: stops.rows.length > 5,
    byVersion: versions.rows.map((r) => {
      const vr = Number(r.runs ?? 0);
      const vo = Number(r.ok ?? 0);
      return {
        version: r.v == null ? null : Number(r.v),
        runs: vr,
        succeeded: vo,
        rate: vr > 0 ? vo / vr : null,
      };
    }),
    series: buckets.map((b) => {
      const settled = b.ok + b.failed + b.review;
      return {
        ts: b.ts,
        label: new Date(b.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        ok: b.ok,
        failed: b.failed,
        needsReview: b.review,
        // null on a quiet day, so the rate line breaks rather than plunging to
        // zero on a day when simply nothing happened.
        rate: settled > 0 ? b.ok / settled : null,
      };
    }),
    previous: {
      runs: prevRuns,
      successRate: prevRuns > 0 ? Number(p?.ok ?? 0) / prevRuns : null,
    },
  };
}
