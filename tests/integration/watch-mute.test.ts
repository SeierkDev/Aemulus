import { beforeAll, describe, expect, it, vi } from "vitest";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createSchedule, setWatch, getWatch, muteUntil } from "../../lib/schedules";
import { evaluateWatchForRun, type WatchSink } from "../../lib/watch-runner";
import type { GeneralizedSkill, Run, Skill } from "../../lib/types";

vi.mock("../../lib/runner", () => ({ executeRun: vi.fn() }));

/**
 * Muting is not pausing.
 *
 * A paused watch stops looking, so when it comes back its baseline is whatever
 * the page said days ago and the first alert is accumulated drift rather than a
 * change. A muted watch keeps looking and keeps its baseline honest; only the
 * message is withheld.
 *
 * That was right about the baseline and incomplete about the silence. Withheld
 * has to mean deferred, not dropped: a value that flips once during the quiet —
 * socials vanishing from a coin page — moves the baseline with it, and if the
 * lift only looks for what has changed SINCE, nothing has, and the alert the
 * watch existed for is never sent. So the lift compares across the whole quiet
 * and reports the net change once. See tests/watch-mute.test.ts.
 */
let skill: Skill;
const sink = (): { alerts: unknown[]; s: WatchSink } => {
  const alerts: unknown[] = [];
  return {
    alerts,
    s: {
      async changed(a) { alerts.push(a); },
      async broken(a) { alerts.push(a); },
      async stalled() {},
    },
  };
};

const runFor = (scheduleId: string, value: string): Run =>
  ({
    id: `run_${Math.random().toString(36).slice(2)}`,
    owner: "w_mute",
    skillId: skill.id,
    scheduleId,
    status: "completed",
    output: { status: value },
    steps: [],
  }) as unknown as Run;

describe("a muted watch", () => {
  let sid = "";
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: "w_mute",
      generalized: { name: "M", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
    sid = await createSchedule({
      owner: "w_mute", skillId: skill.id, input: {},
      cadence: "hourly", level: 2, tier: "pro",
    });
    await setWatch(sid, "w_mute", { key: "status", op: "changed" }, null);
  });

  it("still checks and still moves its baseline while quiet", async () => {
    const a = sink();
    await evaluateWatchForRun(runFor(sid, "Pending"), a.s); // baseline
    await muteUntil(sid, "w_mute", Date.now() + 3600_000);

    await evaluateWatchForRun(runFor(sid, "Shipped"), a.s);
    // No message...
    expect(a.alerts).toHaveLength(0);
    // ...but it looked, and it remembers what it saw.
    expect((await getWatch(sid))!.state.lastValue).toBe("Shipped");
  });

  // Pending → Shipped happened while nobody was listening. One message when
  // the listening resumes — not one per hop, and not none at all.
  it("reports what moved during the quiet, once", async () => {
    const a = sink();
    await muteUntil(sid, "w_mute", Date.now() - 1000); // expired
    await evaluateWatchForRun(runFor(sid, "Shipped"), a.s);
    expect(a.alerts).toHaveLength(1);
    expect(a.alerts[0]).toMatchObject({ from: "Pending", to: "Shipped" });

    // And then it is a normal watch again: no repeat of the catch-up, and the
    // next genuine change alerts on its own terms.
    await evaluateWatchForRun(runFor(sid, "Shipped"), a.s);
    expect(a.alerts).toHaveLength(1);
    await evaluateWatchForRun(runFor(sid, "Delivered"), a.s);
    expect(a.alerts).toHaveLength(2);
  });
});
