import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Run } from "../lib/types";
import type { WatchState } from "../lib/watches";
import type { WatchAction } from "../lib/watch-action";

/**
 * What a mute is allowed to cost you, now that a watch can ACT.
 *
 * The lift path was written when the only consequence was a message, and it
 * carried two assumptions that stopped being safe the moment a rule could start
 * a skill: that any difference across the quiet is an event, and that saying so
 * is the whole job. The first spuriously fires a threshold watch; the second
 * drops the action for the one event the mute-lift comparison exists to catch —
 * permanently, because the new baseline is persisted either way.
 */

const cfg: {
  rule: { key: string; op: string; value?: string };
  action: WatchAction;
  current: WatchState;
  muted: number | null;
} = {
  rule: { key: "socials", op: "changed" },
  action: { kind: "alert" },
  current: { lastValue: "yes", failStreak: 0 },
  muted: null,
};

vi.mock("../lib/schedules", () => ({
  getWatch: async () => ({
    owner: "wallet",
    rule: cfg.rule,
    action: cfg.action,
    state: cfg.current,
    notify: { channel: "telegram", chatId: "1" },
    mutedUntil: cfg.muted,
  }),
  setWatchState: async (_id: string, s: WatchState) => {
    cfg.current = s;
  },
}));

type ChainArgs = { subSkillId: string; parentSkillId: string; owner: string };
type ChainRes = { runId: string } | { skipped: string };
const started = vi.fn(async (_args: ChainArgs): Promise<ChainRes> => ({ runId: "child_run" }));
vi.mock("../lib/chain", () => ({ startChainedRun: (a: ChainArgs) => started(a) }));

const { evaluateWatchForRun } = await import("../lib/watch-runner");

function check(value: string, at: number) {
  const changed = vi.fn();
  const sink = { changed, broken: vi.fn(), stalled: vi.fn() } as never;
  const run = {
    id: "r",
    skillId: "watched_skill",
    scheduleId: "sch",
    status: "completed",
    output: { [cfg.rule.key]: value },
  } as unknown as Run;
  return evaluateWatchForRun(run, sink, at).then(() => changed);
}

const HOUR = 3_600_000;

beforeEach(() => {
  started.mockClear();
  cfg.rule = { key: "socials", op: "changed" };
  cfg.action = { kind: "alert" };
  cfg.current = { lastValue: "yes", failStreak: 0 };
  cfg.muted = null;
});

describe("a mute lifting", () => {
  it("judges the quiet by the rule, not by raw difference", async () => {
    // "above 100", muted, and the value wandered 50 -> 60. Nothing crossed.
    // This alerted purely because the two strings differed.
    cfg.rule = { key: "holders", op: "above", value: "100" };
    cfg.current = { lastValue: "50", failStreak: 0 };
    cfg.muted = 2 * HOUR;
    await check("55", HOUR); // during the quiet
    cfg.muted = null;
    const changed = await check("60", 3 * HOUR); // after it lifts
    expect(changed).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
  });

  it("still reports a real crossing that happened while quiet", async () => {
    cfg.rule = { key: "holders", op: "above", value: "100" };
    cfg.current = { lastValue: "50", failStreak: 0 };
    cfg.muted = 2 * HOUR;
    await check("140", HOUR);
    cfg.muted = null;
    const changed = await check("150", 3 * HOUR);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("runs the action for a change that happened while quiet", async () => {
    // The event the whole mute-lift comparison exists to catch. It was reported
    // and never acted on, and the baseline had already moved — so the next
    // check saw nothing and the action was gone for good.
    cfg.action = { kind: "run_skill", skillId: "target_skill" };
    cfg.muted = 2 * HOUR;
    await check("no", HOUR);
    cfg.muted = null;
    await check("no", 3 * HOUR);
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0][0]).toMatchObject({
      subSkillId: "target_skill",
      parentSkillId: "watched_skill",
      owner: "wallet",
    });
  });

  it("with the message turned off, the action runs and nothing is said", async () => {
    cfg.action = { kind: "run_skill", skillId: "target_skill", alsoAlert: false };
    cfg.muted = 2 * HOUR;
    await check("no", HOUR);
    cfg.muted = null;
    const changed = await check("no", 3 * HOUR);
    expect(started).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it("says something when the action was asked for and could not run", async () => {
    cfg.action = { kind: "run_skill", skillId: "target_skill", alsoAlert: false };
    started.mockImplementationOnce(async () => ({ skipped: "daily run limit reached" }));
    cfg.muted = 2 * HOUR;
    await check("no", HOUR);
    cfg.muted = null;
    const changed = await check("no", 3 * HOUR);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("does not act when there was no baseline before the quiet", async () => {
    cfg.action = { kind: "run_skill", skillId: "target_skill" };
    cfg.current = { lastValue: null, failStreak: 0 };
    cfg.muted = 2 * HOUR;
    await check("yes", HOUR);
    cfg.muted = null;
    await check("no", 3 * HOUR);
    expect(started).not.toHaveBeenCalled();
  });
});
