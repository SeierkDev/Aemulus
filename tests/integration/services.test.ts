import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createRun } from "../../lib/runs";
import { createSkill } from "../../lib/skills";
import { getQuota } from "../../lib/quota";
import { creditEarning, getEarningsSummary } from "../../lib/earnings";
import type { GeneralizedSkill } from "../../lib/types";
import type { Session as Sess } from "../../lib/siws";

const QO = "WALLET_QUOTA";
const EO = "WALLET_EARN";
let SKILL = "";
const session = (level: number, tier: string): Sess => ({
  pubkey: QO,
  tier: tier as Sess["tier"],
  level,
  balance: 0,
});
const gen: GeneralizedSkill = {
  name: "q",
  description: "",
  inputFields: [],
  steps: [
    {
      intent: "o",
      action: "navigate",
      selectors: [],
      target: "data:text/html,<p>x</p>",
      valueSource: "none",
      value: "",
      inputKey: "",
      key: "",
    },
  ],
};

beforeAll(async () => {
  await ready();
  SKILL = (await createSkill({ owner: QO, generalized: gen, sourceDemoId: null })).id;
});

describe("getQuota", () => {
  it("tracks usage against the tier limit and flips ok at the cap", async () => {
    const limit = (await getQuota(session(1, "Holder"))).limit; // default Holder = 5
    expect(limit).toBeGreaterThan(0);

    for (let i = 0; i < limit; i++) {
      await createRun({ owner: QO, skillId: SKILL, input: {} });
    }
    const q = await getQuota(session(1, "Holder"));
    expect(q.used).toBeGreaterThanOrEqual(limit);
    expect(q.ok).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it("whale/open is unlimited", async () => {
    const q = await getQuota(session(3, "Whale"));
    expect(q.unlimited).toBe(true);
    expect(q.ok).toBe(true);
    expect(q.remaining).toBeNull();
  });
});

describe("getEarningsSummary", () => {
  it("totals across skills + recent feed", async () => {
    // Distinct (skill, runner) pairs — a creator earns once per pair, so skill
    // "a"'s 20 comes from two different runners.
    await creditEarning({ owner: EO, skillId: "a", runId: "r1", runner: "X", amount: 10 });
    await creditEarning({ owner: EO, skillId: "a", runId: "r2", runner: "Y", amount: 10 });
    await creditEarning({ owner: EO, skillId: "b", runId: "r3", runner: "Z", amount: 5 });

    const sum = await getEarningsSummary(EO);
    expect(sum.total).toBe(25);
    expect(sum.runs).toBe(3);
    expect(sum.bySkill).toHaveLength(2);
    expect(sum.recent.length).toBeGreaterThanOrEqual(3);
    // ordered by total desc → skill "a" (20) first
    expect(sum.bySkill[0].total).toBe(20);
  });

  it("ignores zero/empty credits", async () => {
    const before = (await getEarningsSummary(EO)).runs;
    await creditEarning({ owner: EO, skillId: "a", runId: "r4", runner: "X", amount: 0 });
    await creditEarning({ owner: "", skillId: "a", runId: "r5", runner: "X", amount: 10 });
    expect((await getEarningsSummary(EO)).runs).toBe(before);
  });
});
