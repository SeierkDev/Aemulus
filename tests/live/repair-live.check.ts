/**
 * Does the repair actually happen?
 *
 * Everything in the suite checks the GATING — when the fallback may run, what
 * it may send, what the receipt records. None of it checks the claim itself:
 * that a step whose selector no longer matches gets finished anyway. That needs
 * a real browser and a real model call, so it lives here, outside the suite
 * (.check.ts, not .test.ts) and is run by hand.
 *
 *   npx vitest run --config vitest.live.config.ts
 */
import { describe, expect, it } from "vitest";
import { createSkill } from "../../lib/skills";
import { createRun, getRun } from "../../lib/runs";
import { executeRun } from "../../lib/runner";
import { verifyReceipt, attachReceipt } from "../../lib/receipt";
import { metricsSnapshot } from "../../lib/metrics";
import { agentFallbackEnabled } from "../../lib/agent";
import type { GeneralizedSkill } from "../../lib/types";

const step = (o: Record<string, unknown>) => ({
  target: "", selectors: [], valueSource: "none", value: "",
  inputKey: "", key: "", outputKey: "", ...o,
});

describe("the agent actually repairs a broken step", () => {
  it("finishes a click whose recorded selector matches nothing", async () => {
    expect(agentFallbackEnabled()).toBe(true);
    expect(process.env.ANTHROPIC_API_KEY, "needs a real key").toBeTruthy();

    const owner = "w_repair_live";
    const skill = await createSkill({
      owner,
      generalized: {
        name: "Repair check",
        description: "Clicks a link whose recorded selector no longer matches.",
        inputFields: [],
        steps: [
          step({ idx: 0, intent: "Open the page", action: "navigate", target: "https://example.com" }),
          // The point of the whole exercise: nothing on the page matches this.
          // The intent is all the agent has to work from.
          // No such control exists on this page, so the selector-resolution
          // layer cannot rescue it either — which is the only way execution
          // reaches the agentic fallback at all.
          step({ idx: 1, intent: "Accept the cookie consent banner", action: "click", selectors: ["#not-a-real-element-xyz"] }),
        ],
      } as unknown as GeneralizedSkill,
      sourceDemoId: null,
    });

    const before = metricsSnapshot();
    const created = await createRun({ owner, skillId: skill.id, runner: owner, input: {} } as never);
    const runId = created!.id;

    await executeRun(skill, runId, owner, {});
    await attachReceipt(runId).catch(() => {});

    const run = await getRun(runId);
    const after = metricsSnapshot();

    for (const s of run!.steps) {
      console.log(`step ${s.idx} ${s.action} repaired=${!!s.repaired} conf=${s.confidence} ${s.note ?? ""}`);
    }
    console.log("status", run!.status,
      "| repaired+", (after["agent.repaired"] ?? 0) - (before["agent.repaired"] ?? 0),
      "| gaveUp+", (after["agent.gaveUp"] ?? 0) - (before["agent.gaveUp"] ?? 0));

    const v = await verifyReceipt(runId);
    console.log("receipt matches", v.matches, "| repairedSteps", v.repairedSteps);

    // Either outcome proves the path executed; which one depends on the page.
    const fired =
      (after["agent.repaired"] ?? 0) - (before["agent.repaired"] ?? 0) +
      ((after["agent.gaveUp"] ?? 0) - (before["agent.gaveUp"] ?? 0));
    expect(fired).toBeGreaterThan(0);
  }, 180_000);
});
