import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  createSkill,
  getSkill,
  setPublished,
  listPublishedSkills,
  listSkills,
  incrementRunCount,
} from "../../lib/skills";
import {
  createRun,
  finishRun,
  getRun,
  addRunStep,
  hasRunSkill,
  countRecentRuns,
} from "../../lib/runs";
import { creditEarning, getEarningsSummary } from "../../lib/earnings";
import {
  rateSkill,
  getSkillReputation,
  getMyRating,
  listReviews,
} from "../../lib/reputation";
import {
  createSchedule,
  dueSchedules,
  markRan,
  bumpNextRun,
  claimSchedule,
  recordRun,
  deactivate,
  listSchedules,
  cadenceMs,
  nextRunAfter,
} from "../../lib/schedules";
import type { GeneralizedSkill } from "../../lib/types";

const CREATOR = "WALLET_CREATOR";
const RUNNER = "WALLET_RUNNER";

function gen(name = "Invoice skill"): GeneralizedSkill {
  return {
    name,
    description: "Adds an invoice",
    inputFields: [{ key: "vendor", label: "Vendor", example: "Acme" }],
    steps: [
      {
        intent: "open",
        action: "navigate",
        selectors: [],
        target: "data:text/html,<p>x</p>",
        valueSource: "none",
        value: "",
        inputKey: "",
        key: "",
      },
      {
        intent: "type vendor",
        action: "input",
        selectors: ["#vendor"],
        target: "vendor",
        valueSource: "input",
        value: "",
        inputKey: "vendor",
        key: "",
      },
    ],
  };
}

beforeAll(async () => {
  await ready();
});

describe("skills lifecycle", () => {
  it("creates, publishes, lists and counts runs", async () => {
    const skill = await createSkill({
      owner: CREATOR,
      generalized: gen(),
      sourceDemoId: null,
    });
    expect(skill.plan).toHaveLength(2);
    expect(skill.plan[1].idx).toBe(1); // idx assigned in order
    expect(skill.published).toBe(false);

    // not in the marketplace until published
    expect(await listPublishedSkills()).toHaveLength(0);
    expect(await setPublished(skill.id, CREATOR, true)).toBe(true);
    const pub = await listPublishedSkills();
    expect(pub.map((s) => s.id)).toContain(skill.id);

    // ownership-scoped: a non-owner can't publish/unpublish
    expect(await setPublished(skill.id, RUNNER, false)).toBe(false);

    await incrementRunCount(skill.id);
    expect((await getSkill(skill.id))!.runCount).toBe(1);
    expect((await listSkills(CREATOR)).map((s) => s.id)).toContain(skill.id);
    expect(await listSkills(RUNNER)).toHaveLength(0);
  });
});

describe("runs lifecycle", () => {
  it("creates a run, records steps, finishes, and reads back", async () => {
    const skill = await createSkill({
      owner: CREATOR,
      generalized: gen("Runnable"),
      sourceDemoId: null,
    });
    const run = await createRun({
      owner: RUNNER,
      skillId: skill.id,
      input: { vendor: "Acme" },
    });
    expect(run.status).toBe("running");
    expect(run.receiptHash).toBeNull();

    await addRunStep({
      id: "rst_1",
      runId: run.id,
      idx: 0,
      intent: "open",
      action: "navigate",
      selectorUsed: "",
      value: "",
      screenshot: "recordings/x/step-0.png",
      confidence: 0.99,
      flagged: false,
      note: "",
      createdAt: Date.now(),
    });
    await finishRun(run.id, { status: "completed", result: "ok", error: null });

    const got = await getRun(run.id);
    expect(got!.status).toBe("completed");
    expect(got!.steps).toHaveLength(1);
    // input round-trips through encryption at rest
    expect(got!.input.vendor).toBe("Acme");

    expect(await hasRunSkill(RUNNER, skill.id)).toBe(true);
    expect(await hasRunSkill(CREATOR, skill.id)).toBe(false);
    expect(await countRecentRuns(RUNNER, Date.now() - 60_000)).toBeGreaterThan(0);
  });
});

describe("creator earnings", () => {
  it("accrues per external run and ignores self-runs / zero amounts", async () => {
    const skill = await createSkill({
      owner: CREATOR,
      generalized: gen("Earner"),
      sourceDemoId: null,
    });
    await creditEarning({
      owner: CREATOR,
      skillId: skill.id,
      runId: "run_1",
      runner: RUNNER,
      amount: 10,
    });
    await creditEarning({
      owner: CREATOR,
      skillId: skill.id,
      runId: "run_2",
      // A distinct runner: a creator earns once per (skill, runner), so a second
      // credit for the same skill comes from a different runner.
      runner: `${RUNNER}_2`,
      amount: 10,
    });
    // zero/empty are no-ops
    await creditEarning({
      owner: CREATOR,
      skillId: skill.id,
      runId: "run_3",
      runner: RUNNER,
      amount: 0,
    });

    const summary = await getEarningsSummary(CREATOR);
    expect(summary.total).toBe(20);
    expect(summary.runs).toBe(2);
  });
});

describe("reputation", () => {
  it("computes success rate from runs and stars from ratings, with rating gate + cache refresh", async () => {
    const skill = await createSkill({
      owner: CREATOR,
      generalized: gen("Rated"),
      sourceDemoId: null,
    });
    await setPublished(skill.id, CREATOR, true);

    // 2 completed, 1 failed → 2/3 success
    for (const status of ["completed", "completed", "failed"] as const) {
      const r = await createRun({
        owner: RUNNER,
        skillId: skill.id,
        input: {},
      });
      await finishRun(r.id, { status, result: null, error: null });
    }

    const rep1 = await getSkillReputation(skill.id);
    expect(rep1.runs).toBe(3);
    expect(rep1.completed).toBe(2);
    expect(rep1.successRate).toBeCloseTo(2 / 3, 5);
    expect(rep1.ratingCount).toBe(0);

    // rate, then re-read — cache must reflect the new rating (invalidation)
    await rateSkill({
      skillId: skill.id,
      rater: RUNNER,
      stars: 5,
      comment: "works great",
    });
    const rep2 = await getSkillReputation(skill.id);
    expect(rep2.ratingCount).toBe(1);
    expect(rep2.avgStars).toBe(5);

    expect((await getMyRating(skill.id, RUNNER))!.stars).toBe(5);
    const reviews = await listReviews(skill.id);
    expect(reviews[0].comment).toBe("works great");
  });
});

describe("schedules", () => {
  it("creates, becomes due, records a run, and deactivates", async () => {
    expect(cadenceMs("hourly")).toBe(3_600_000);
    expect(cadenceMs("daily")).toBe(86_400_000);

    const skill = await createSkill({
      owner: CREATOR,
      generalized: gen("Scheduled"),
      sourceDemoId: null,
    });
    const sid = await createSchedule({
      owner: CREATOR,
      skillId: skill.id,
      input: { vendor: "Acme" },
      cadence: "daily",
      level: 1,
      tier: "Holder",
    });

    // freshly created → not yet due
    expect((await dueSchedules(Date.now())).find((s) => s.id === sid)).toBeUndefined();

    // force due → appears, and decrypts its stored input
    await bumpNextRun(sid, Date.now() - 1000);
    const due = await dueSchedules(Date.now());
    const mine = due.find((s) => s.id === sid);
    expect(mine).toBeDefined();
    expect(mine!.input.vendor).toBe("Acme");

    // mark ran → next_run pushed to the future → no longer due
    await markRan(sid, "run_x", Date.now() + cadenceMs("daily"));
    expect((await dueSchedules(Date.now())).find((s) => s.id === sid)).toBeUndefined();

    expect((await listSchedules(CREATOR)).map((s) => s.id)).toContain(sid);

    // deactivate → never due again
    await bumpNextRun(sid, Date.now() - 1000);
    await deactivate(sid);
    expect((await dueSchedules(Date.now())).find((s) => s.id === sid)).toBeUndefined();
  });

  it("nextRunAfter: fixed intervals + weekdays never land on a weekend", () => {
    const t0 = 1_700_000_000_000;
    expect(nextRunAfter("hourly", t0) - t0).toBe(cadenceMs("hourly"));
    expect(nextRunAfter("weekly", t0) - t0).toBe(7 * 86_400_000);
    // weekdays: scan a full week of starting points; never Sat(6)/Sun(0)
    for (let i = 0; i < 7; i++) {
      const next = nextRunAfter("weekdays", t0 + i * 86_400_000);
      const day = new Date(next).getDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("claims a firing exactly once (durable against double-run)", async () => {
    const skill = await createSkill({
      owner: CREATOR,
      generalized: gen("Claimable"),
      sourceDemoId: null,
    });
    const sid = await createSchedule({
      owner: CREATOR,
      skillId: skill.id,
      input: {},
      cadence: "hourly",
      level: 1,
      tier: "Holder",
    });
    const now = Date.now();
    await bumpNextRun(sid, now - 1000); // force due

    // Two concurrent ticks/instances race to claim — only one wins.
    const next = now + cadenceMs("hourly");
    const first = await claimSchedule(sid, now, next);
    const second = await claimSchedule(sid, now, next);
    expect(first).toBe(true);
    expect(second).toBe(false);

    await recordRun(sid, "run_y");
    const sched = (await listSchedules(CREATOR)).find((s) => s.id === sid);
    expect(sched!.lastRunId).toBe("run_y");
  });
});
