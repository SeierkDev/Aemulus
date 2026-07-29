import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createRun, getRun } from "../../lib/runs";
import { getClaimable } from "../../lib/earnings";
import { finalizeExtensionRun } from "../../lib/ext-run";
import { SOLANA } from "../../lib/solana";
import type { GeneralizedSkill } from "../../lib/types";

function gen(name: string): GeneralizedSkill {
  return {
    name,
    description: "d",
    inputFields: [{ key: "q", label: "Q", example: "x" }],
    steps: [
      { intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" },
      { intent: "enter q", action: "input", selectors: ["input"], target: "q", valueSource: "input", value: "", inputKey: "q", key: "" },
    ],
  };
}

beforeAll(async () => { await ready(); });

describe("finalizeExtensionRun (browser-executed runs settle like cloud runs)", () => {
  it("records steps, attaches a receipt, and does NOT pay the owner for their own run", async () => {
    const OWNER = "WALLET_EXT_OWNER";
    const skill = await createSkill({ owner: OWNER, generalized: gen("Ext own"), sourceDemoId: null });
    const run = await createRun({ owner: OWNER, skillId: skill.id, input: { q: "hello" } });

    const before = await getClaimable(OWNER);
    const final = await finalizeExtensionRun({
      runId: run.id,
      owner: OWNER,
      skill,
      status: "completed",
      steps: skill.plan.map((s) => ({ idx: s.idx, selectorUsed: "x", value: s.inputKey ? "hello" : "", confidence: 0.99 })),
    });

    expect(final.status).toBe("completed");
    expect(final.receiptHash).toBeTruthy(); // verifiable receipt attached
    const fetched = await getRun(run.id);
    expect(fetched!.steps.length).toBe(skill.plan.length); // every step recorded
    // Owner ran their own skill → no self-payment.
    expect(await getClaimable(OWNER)).toBe(before);
  });

  it("pays the creator when someone ELSE runs their skill in the browser", async () => {
    const CREATOR = "WALLET_EXT_CREATOR";
    const RUNNER = "WALLET_EXT_RUNNER";
    const skill = await createSkill({ owner: CREATOR, generalized: gen("Ext external"), sourceDemoId: null });
    // A run owned by the RUNNER (they executed it in their browser).
    const run = await createRun({ owner: RUNNER, skillId: skill.id, input: { q: "hi" } });

    const before = await getClaimable(CREATOR);
    const final = await finalizeExtensionRun({
      runId: run.id,
      owner: RUNNER,
      skill,
      status: "completed",
      steps: skill.plan.map((s) => ({ idx: s.idx, selectorUsed: "x", value: s.inputKey ? "hi" : "", confidence: 0.99 })),
    });

    expect(final.status).toBe("completed");
    // External completed run → creator earns exactly one run fee.
    expect(await getClaimable(CREATOR)).toBe(before + SOLANA.runFee);
  });

  it("secret-field values are never persisted in the step record", async () => {
    const OWNER = "WALLET_EXT_SECRET";
    const g = gen("Ext secret");
    g.inputFields = [{ key: "password", label: "Password", example: "", secret: true }];
    g.steps[1] = { intent: "enter password", action: "input", selectors: ["input"], target: "password", valueSource: "input", value: "", inputKey: "password", key: "" };
    const skill = await createSkill({ owner: OWNER, generalized: g, sourceDemoId: null });
    const run = await createRun({ owner: OWNER, skillId: skill.id, input: { password: "s3cr3t" } });

    await finalizeExtensionRun({
      runId: run.id,
      owner: OWNER,
      skill,
      status: "completed",
      steps: skill.plan.map((s) => ({ idx: s.idx, selectorUsed: "x", value: s.inputKey === "password" ? "s3cr3t" : "", confidence: 0.99 })),
    });

    const fetched = await getRun(run.id);
    const secretStep = fetched!.steps.find((s) => s.intent.includes("password"));
    expect(secretStep!.value).toBe(""); // redacted, never stored
  });
});
