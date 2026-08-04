import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { getSkillAnalytics, windowDays, MAX_DAYS } from "../../lib/analytics";
import type { GeneralizedSkill, Skill } from "../../lib/types";

/**
 * Per-skill analytics.
 *
 * The rate is the point, so the tests are about the rate being right and about
 * "no data" never being reported as zero.
 */

let skill: Skill;
const DAY = 24 * 60 * 60 * 1000;

async function run(status: string, runner: string, at: number) {
  await db.execute({
    sql: `INSERT INTO runs (id, owner, skill_id, status, input, created_at, updated_at, tokens_in, tokens_out)
          VALUES (?, ?, ?, ?, '{}', ?, ?, 10, 5)`,
    args: [`run_an_${Math.random().toString(36).slice(2)}`, runner, skill.id, status, at, at],
  });
}

describe("getSkillAnalytics", () => {
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: "wallet_an_owner",
      generalized: { name: "A", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
  });

  // A rate over zero runs is unknown, not perfect and not zero. Reporting 0%
  // would tell an author their skill is broken the day they publish it.
  it("reports an unknown success rate rather than 0% when nothing has run", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    expect(a.runs).toBe(0);
    expect(a.successRate).toBeNull();
  });

  it("separates a hard failure from a run that stopped to ask a person", async () => {
    const now = Date.now();
    await run("completed", "w1", now - DAY);
    await run("completed", "w2", now - DAY);
    await run("failed", "w1", now - DAY);
    // needs_review stopped to ask a human: not a success, and the author wants
    // to see it.
    await run("needs_review", "w3", now - DAY);

    const a = await getSkillAnalytics(skill.id, 30);
    expect(a.runs).toBe(4);
    expect(a.succeeded).toBe(2);
    // Broken and "asked a human" are different problems with different fixes,
    // even though neither is a success.
    expect(a.failed).toBe(1);
    expect(a.needsReview).toBe(1);
    // Both still count against the rate: only completing is succeeding.
    expect(a.successRate).toBeCloseTo(0.5, 5);
  });

  // A run that started ten seconds ago has not failed. Counting in-flight runs
  // against the rate made a busy skill look like it was collapsing whenever the
  // page was opened mid-run.
  it("never counts a still-running run against the rate", async () => {
    const now = Date.now();
    await run("running", "w1", now);
    await run("queued", "w2", now);

    const a = await getSkillAnalytics(skill.id, 30);
    expect(a.inFlight).toBe(2);
    expect(a.runs).toBe(4); // unchanged: only settled runs
    expect(a.successRate).toBeCloseTo(0.5, 5);
  });

  // One-time curiosity and genuine usefulness look identical in a unique-user
  // count.
  it("counts wallets that came back", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    // w1 has two settled runs. w2 started a second one but it is still queued,
    // and every figure in this row counts settled runs so the tiles agree with
    // each other on screen.
    expect(a.repeatUsers).toBe(1);
    expect(a.repeatUsers).toBeLessThanOrEqual(a.uniqueUsers);
  });

  it("counts distinct wallets, not runs", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    // w1 ran twice; three wallets in total.
    expect(a.uniqueUsers).toBe(3);
  });

  it("returns one bucket per day in the window, including the empty ones", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    expect(a.series.length).toBe(30);
    // A chart that omits quiet days compresses time and makes a gap look busy.
    const settled = (d: { ok: number; failed: number; needsReview: number }) =>
      d.ok + d.failed + d.needsReview;
    expect(a.series.filter((d) => settled(d) === 0).length).toBeGreaterThan(0);
    expect(a.series.reduce((n, d) => n + settled(d), 0)).toBe(4);
    // A quiet day has an unknown rate, not a rate of zero.
    expect(a.series.find((d) => settled(d) === 0)?.rate).toBeNull();
  });

  // Runs outside the window must not leak into the totals, or every number
  // silently becomes all-time and the comparison against the previous period
  // stops meaning anything.
  it("excludes runs older than the window", async () => {
    await run("completed", "w9", Date.now() - 60 * DAY);
    const a = await getSkillAnalytics(skill.id, 7);
    expect(a.runs).toBe(4);
    expect(a.uniqueUsers).toBe(3);
  });

  // The page tells an author their rate dropped; this is the part that tells
  // them where to look.
  it("reports where runs that did not complete got to", async () => {
    const now = Date.now();
    const stopped = `run_stop_${Math.random().toString(36).slice(2)}`;
    await db.execute({
      sql: `INSERT INTO runs (id, owner, skill_id, status, input, created_at, updated_at)
            VALUES (?, 'w5', ?, 'failed', '{}', ?, ?)`,
      args: [stopped, skill.id, now, now],
    });
    // Two steps: it got through the first and stopped on the second.
    for (const [i, intent] of [[0, "open the orders page"], [1, "click Continue"]] as const) {
      await db.execute({
        sql: `INSERT INTO run_steps (id, run_id, idx, intent, action, screenshot, confidence, flagged, note, created_at)
              VALUES (?, ?, ?, ?, 'click', '', 1, 0, '', ?)`,
        args: [`st_${stopped}_${i}`, stopped, i, intent, now],
      });
    }

    const a = await getSkillAnalytics(skill.id, 30);
    const top = a.stops.find((sp) => sp.idx === 1);
    expect(top).toBeTruthy();
    expect(top!.intent).toBe("click Continue");
    // Attributed to the LAST step reached, not the first, and not every step.
    expect(a.stops.some((sp) => sp.idx === 0)).toBe(false);
  });

  // Skills change and heal themselves, so "the rate dropped" is only useful next
  // to "and it dropped on v2".
  it("splits the rate by the version each run actually executed", async () => {
    const now = Date.now();
    const mk = async (v: number | null, status: string) => {
      await db.execute({
        sql: `INSERT INTO runs (id, owner, skill_id, skill_version, status, input, created_at, updated_at)
              VALUES (?, 'w6', ?, ?, ?, '{}', ?, ?)`,
        args: [`run_v_${Math.random().toString(36).slice(2)}`, skill.id, v, status, now, now],
      });
    };
    await mk(2, "completed");
    await mk(2, "completed");
    await mk(3, "failed");

    const a = await getSkillAnalytics(skill.id, 30);
    const v2 = a.byVersion.find((v) => v.version === 2);
    const v3 = a.byVersion.find((v) => v.version === 3);
    expect(v2?.rate).toBeCloseTo(1, 5);
    expect(v3?.rate).toBeCloseTo(0, 5);
    // Runs from before the column existed are reported as unknown, never folded
    // into v1, which would attribute failures to a version that never ran them.
    expect(a.byVersion.some((v) => v.version === null)).toBe(true);
  });

  // The most common failure of all: the page never loaded, the host was blocked,
  // the browser would not start. An inner join dropped these entirely, so the
  // author saw "N failed" above a card that explained nothing.
  it("still reports a run that failed before any step executed", async () => {
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO runs (id, owner, skill_id, status, input, created_at, updated_at)
            VALUES (?, 'w7', ?, 'failed', '{}', ?, ?)`,
      args: [`run_nostep_${Math.random().toString(36).slice(2)}`, skill.id, now, now],
    });
    const a = await getSkillAnalytics(skill.id, 30);
    const never = a.stops.find((sp) => sp.idx === -1);
    expect(never).toBeTruthy();
    expect(never!.stops).toBeGreaterThan(0);
  });

  // The tiles sit side by side, so counting in-flight runs in one and not the
  // other produced "4 runs, 6 unique users".
  it("counts users over the same runs the run count uses", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    expect(a.uniqueUsers).toBeLessThanOrEqual(a.runs);
    expect(a.repeatUsers).toBeLessThanOrEqual(a.uniqueUsers);
  });

  it("clamps the window whatever it is given", () => {
    expect(windowDays(0)).toBe(7);
    expect(windowDays(9999)).toBe(MAX_DAYS);
    expect(windowDays("abc")).toBe(30);
    expect(windowDays(-5)).toBe(7);
  });

  // Aggregates are over other people's runs. A creator is entitled to know how
  // many wallets used their skill and never which ones, so no identifier may
  // ride along in the payload.
  it("never carries a runner identity in the result", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    const blob = JSON.stringify(a);
    for (const w of ["w1", "w2", "w3", "w9", "wallet_an_owner"]) {
      expect(blob).not.toContain(w);
    }
  });
});

describe("skillTotals", () => {
  // The digest asks for this once per published skill, per chat, on a scheduler
  // tick. It must agree with the full analytics it stands in for, or the two
  // surfaces report different numbers for the same skill.
  it("matches the headline numbers getSkillAnalytics computes", async () => {
    const { skillTotals } = await import("../../lib/analytics");
    const full = await getSkillAnalytics(skill.id, 7);
    const quick = await skillTotals(skill.id, 7);
    expect(quick.runs).toBe(full.runs);
    expect(quick.succeeded).toBe(full.succeeded);
    if (full.successRate === null) expect(quick.rate).toBeNull();
    else expect(quick.rate).toBeCloseTo(full.successRate, 10);
  });
});
