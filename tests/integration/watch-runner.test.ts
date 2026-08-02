import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createSchedule, getWatch, setWatch } from "../../lib/schedules";
import {
  evaluateWatchForRun,
  type BrokenAlert,
  type StalledAlert,
  type WatchAlert,
  type WatchSink,
} from "../../lib/watch-runner";
import type { GeneralizedSkill, Run, Skill } from "../../lib/types";

/**
 * The wiring between a finished run and an alert.
 *
 * The decision logic is tested in tests/watches.test.ts; this covers the parts
 * that only exist once a database is involved — that state survives between
 * checks, that a run with no schedule is ignored, and above all that a failed
 * run is not mistaken for a change.
 */

const OWNER = "watch_test_owner";
let skill: Skill;

function collector() {
  const changed: WatchAlert[] = [];
  const broken: BrokenAlert[] = [];
  const stalled: StalledAlert[] = [];
  const sink: WatchSink = {
    async changed(a) { changed.push(a); },
    async broken(a) { broken.push(a); },
    async stalled(a) { stalled.push(a); },
  };
  return { changed, broken, stalled, sink };
}

/** A settled run, as finalizeRunAccounting would hand it over. */
function run(over: Partial<Run> = {}): Run {
  return {
    id: "run_" + Math.random().toString(36).slice(2, 10),
    owner: OWNER,
    skillId: skill.id,
    status: "completed",
    input: {},
    overrides: {},
    result: "ok",
    error: null,
    receiptHash: null,
    receiptSig: null,
    receiptCluster: null,
    batchId: null,
    leafIndex: null,
    merkleProof: null,
    bulkId: null,
    rowIndex: null,
    output: null,
    tokensIn: 0,
    tokensOut: 0,
    outcomeStatus: null,
    sandbox: null,
    scheduleId: null,
    outcomeReason: null,
    commitmentRoot: null,
    registrySig: null,
    registryCluster: null,
    zkSig: null,
    zkAddress: null,
    zkCluster: null,
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  } as Run;
}

async function newWatch(rule: Parameters<typeof setWatch>[2]) {
  const id = await createSchedule({
    owner: OWNER,
    skillId: skill.id,
    input: {},
    cadence: "hourly",
    level: 3,
    tier: "Whale",
  });
  await setWatch(id, OWNER, rule, { channel: "telegram", chatId: "123" });
  return id;
}

beforeAll(async () => {
  await ready();
  const gen: GeneralizedSkill = {
    name: "Watched",
    description: "",
    inputFields: [],
    steps: [],
  };
  skill = await createSkill({ owner: OWNER, generalized: gen, sourceDemoId: null });
}, 60_000);

describe("evaluateWatchForRun", () => {
  it("ignores a run that did not come from a schedule", async () => {
    const { sink, changed } = collector();
    expect(await evaluateWatchForRun(run(), sink)).toBeNull();
    expect(changed).toHaveLength(0);
  });

  it("ignores a schedule with no watch attached", async () => {
    const plain = await createSchedule({
      owner: OWNER, skillId: skill.id, input: {}, cadence: "daily", level: 3, tier: "Whale",
    });
    const { sink, changed } = collector();
    expect(await evaluateWatchForRun(run({ scheduleId: plain }), sink)).toBeNull();
    expect(changed).toHaveLength(0);
  });

  it("stays quiet on the first check but remembers the baseline", async () => {
    const id = await newWatch({ key: "status", op: "changed" });
    const { sink, changed } = collector();
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "pending" } }), sink);
    expect(changed).toHaveLength(0);
    // The baseline has to survive to the next check, which is the whole reason
    // state is persisted rather than held in memory.
    expect((await getWatch(id))!.state.lastValue).toBe("pending");
  });

  it("alerts when the watched field moves", async () => {
    const id = await newWatch({ key: "status", op: "changed" });
    const { sink, changed } = collector();
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "pending" } }), sink);
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "shipped" } }), sink);
    expect(changed).toHaveLength(1);
    expect(changed[0].from).toBe("pending");
    expect(changed[0].to).toBe("shipped");
    expect(changed[0].key).toBe("status");
    expect(changed[0].notify?.chatId).toBe("123");
  });

  it("ignores fields the watch is not watching", async () => {
    const id = await newWatch({ key: "status", op: "changed" });
    const { sink, changed } = collector();
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "a", other: "1" } }), sink);
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "a", other: "2" } }), sink);
    expect(changed).toHaveLength(0);
  });

  // The rule that decides whether people keep this switched on.
  describe("a failed check is never a change", () => {
    it("does not alert when the run failed", async () => {
      const id = await newWatch({ key: "status", op: "changed" });
      const { sink, changed, broken } = collector();
      await evaluateWatchForRun(run({ scheduleId: id, output: { status: "$1,249" } }), sink);
      await evaluateWatchForRun(run({ scheduleId: id, status: "failed", output: null }), sink);
      expect(changed).toHaveLength(0);
      expect(broken).toHaveLength(0);
      // Baseline untouched: "$1,249" did not become "".
      expect((await getWatch(id))!.state.lastValue).toBe("$1,249");
    });

    it("treats a completed run that captured nothing as a failure too", async () => {
      const id = await newWatch({ key: "status", op: "changed" });
      const { sink, changed } = collector();
      await evaluateWatchForRun(run({ scheduleId: id, output: { status: "here" } }), sink);
      // Completed, but the extract step found nothing — a login lapsing looks
      // exactly like this, and it must not read as the value disappearing.
      await evaluateWatchForRun(run({ scheduleId: id, output: {} }), sink);
      expect(changed).toHaveLength(0);
      expect((await getWatch(id))!.state.lastValue).toBe("here");
    });

    it("says the watch is broken after repeated failures, once", async () => {
      const id = await newWatch({ key: "status", op: "changed" });
      const { sink, broken } = collector();
      for (let i = 0; i < 6; i++) {
        await evaluateWatchForRun(run({ scheduleId: id, status: "failed" }), sink);
      }
      expect(broken).toHaveLength(1);
      expect(broken[0].scheduleId).toBe(id);
    });
  });

  it("carries the confirm counter across checks", async () => {
    const id = await newWatch({ key: "status", op: "changed", confirm: 2 });
    const { sink, changed } = collector();
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "a" } }), sink);
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "b" } }), sink);
    expect(changed).toHaveLength(0); // seen once, needs two
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "b" } }), sink);
    expect(changed).toHaveLength(1);
  });

  it("resets state when the rule is replaced", async () => {
    const id = await newWatch({ key: "status", op: "changed" });
    const { sink } = collector();
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "old" } }), sink);
    // A new rule asks a different question; carrying the old baseline over
    // would alert on the very first check under the new rule.
    await setWatch(id, OWNER, { key: "price", op: "above", value: "10" }, null);
    expect((await getWatch(id))!.state.lastValue).toBeNull();
  });

  it("never lets a watch failure escape into run settlement", async () => {
    const id = await newWatch({ key: "status", op: "changed" });
    const exploding: WatchSink = {
      async changed() { throw new Error("sink is down"); },
      async broken() { throw new Error("sink is down"); },
      async stalled() { throw new Error("sink is down"); },
    };
    await evaluateWatchForRun(run({ scheduleId: id, output: { status: "a" } }), exploding);
    // The run has already settled and its receipt is attached by this point, so
    // the worst a broken sink may cost is one missed alert.
    await expect(
      evaluateWatchForRun(run({ scheduleId: id, output: { status: "b" } }), exploding),
    ).resolves.toBeNull();
  });
});
