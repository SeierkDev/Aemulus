import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Run } from "../lib/types";
import type { WatchState } from "../lib/watches";
import type { WatchAction } from "../lib/watch-action";

/**
 * Does the action actually fire?
 *
 * Everything else about v0.1.3 was covered by unit tests over pure functions and
 * by reading source. Neither proves the thing the feature exists for: that a
 * real change starts a real run, and that the three states where it must NOT —
 * broken, muted, unchanged — stay silent.
 */

const world: {
  state: WatchState;
  muted: number | null;
  action: WatchAction | undefined;
} = {
  state: { lastValue: "7.4%", failStreak: 0 },
  muted: null,
  action: { kind: "run_skill", skillId: "skl_exit" },
};

vi.mock("../lib/schedules", () => ({
  getWatch: async () => ({
    owner: "wallet",
    rule: { key: "dev", op: "below", value: "5" },
    state: world.state,
    notify: { channel: "telegram", chatId: "1" },
    mutedUntil: world.muted,
    action: world.action,
  }),
  setWatchState: async (_id: string, s: WatchState) => {
    world.state = s;
  },
}));

type ChainArgs = {
  parentSkillId: string;
  subSkillId: string;
  owner: string;
  parentOutputs: Record<string, string>;
};
// Typed through the mock so the call is checked, not just recorded: the whole
// point of the assertions below is which arguments the watch hands over.
const started =
  vi.fn<(args: ChainArgs) => Promise<{ runId: string } | { skipped: string }>>();
started.mockResolvedValue({ runId: "run_child" });
vi.mock("../lib/chain", () => ({ startChainedRun: (a: ChainArgs) => started(a) }));

const { evaluateWatchForRun } = await import("../lib/watch-runner");

function check(value: string, status: Run["status"] = "completed") {
  const changed = vi.fn();
  const broken = vi.fn();
  const sink = { changed, broken, stalled: vi.fn() } as never;
  const run = {
    id: "r",
    skillId: "skl_watched",
    scheduleId: "sch",
    status,
    output: { dev: value },
  } as unknown as Run;
  return evaluateWatchForRun(run, sink, Date.now()).then(() => ({ changed, broken }));
}

beforeEach(() => {
  world.state = { lastValue: "7.4%", failStreak: 0 };
  world.muted = null;
  world.action = { kind: "run_skill", skillId: "skl_exit" };
  started.mockReset();
  started.mockResolvedValue({ runId: "run_child" });
});

describe("when the rule fires", () => {
  it("runs the skill and hands it the value that fired it", async () => {
    const { changed } = await check("4.2%");
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0][0]).toMatchObject({
      subSkillId: "skl_exit",
      owner: "wallet",
      // The watched skill is the parent, so chaining's self-reference guard
      // applies — a watch cannot trigger the skill it is watching.
      parentSkillId: "skl_watched",
      parentOutputs: { dev: "4.2%" },
    });
    // And you are still told, by default.
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the rule is not satisfied", async () => {
    const { changed } = await check("6.8%"); // still above 5
    expect(started).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("when it must stay out of the way", () => {
  it("never acts on a failed check", async () => {
    // "The check could not read the value" is the one state where acting on it
    // is exactly wrong.
    await check("", "failed");
    expect(started).not.toHaveBeenCalled();
  });

  it("never acts while muted", async () => {
    world.muted = Date.now() + 60_000;
    const { changed } = await check("4.2%");
    expect(started).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("does nothing extra for an alert-only watch", async () => {
    world.action = { kind: "alert" };
    const { changed } = await check("4.2%");
    expect(started).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("still alerts when the watch has no action at all", async () => {
    // Every watch that predates the column reads back undefined here.
    world.action = undefined;
    const { changed } = await check("4.2%");
    expect(started).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("when the action was meant to replace the message", () => {
  it("stays quiet if the run started", async () => {
    world.action = { kind: "run_skill", skillId: "skl_exit", alsoAlert: false };
    const { changed } = await check("4.2%");
    expect(started).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it("speaks up if it did not", async () => {
    // Silence would be the worst of both: nothing done and nothing said.
    world.action = { kind: "run_skill", skillId: "skl_exit", alsoAlert: false };
    started.mockImplementationOnce(async () => ({ skipped: "daily run limit reached" }));
    const { changed } = await check("4.2%");
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("the very first check", () => {
  // "changed" already refuses to fire without a baseline, because it would fire
  // for every new watch. The threshold ops never consult the baseline, which is
  // fine for a message and not fine for an ACTION: creating a watch on a page
  // whose condition is already true would run a skill immediately, before
  // anything had happened.
  it("alerts but does not act", async () => {
    world.state = { lastValue: null, failStreak: 0 };
    const { changed } = await check("4.2%"); // already below 5
    expect(started).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("acts on the crossing that follows, not on drifting within the range", async () => {
    world.state = { lastValue: null, failStreak: 0 };
    await check("4.2%"); // already below: alerts, but no baseline to act from
    expect(started).not.toHaveBeenCalled();
    // Still below. Not an event — thresholds are edge-triggered, or an hourly
    // watch would run the skill every hour for as long as it stayed below.
    await check("4.1%");
    expect(started).not.toHaveBeenCalled();
    // Back over, then down through it again. That is the crossing.
    await check("6.0%");
    await check("4.4%");
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("still speaks when the action was meant to replace the message", async () => {
    // Nothing done and nothing said is the one outcome to avoid.
    world.state = { lastValue: null, failStreak: 0 };
    world.action = { kind: "run_skill", skillId: "skl_exit", alsoAlert: false };
    const { changed } = await check("4.2%");
    expect(started).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
