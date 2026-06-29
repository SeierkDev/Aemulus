import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, updateSkill, getSkill, learnSelectors } from "../../lib/skills";
import type { GeneralizedSkill, SkillStep } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "H", description: "", inputFields: [], steps: [] };

function step(idx: number, selectors: string[]): SkillStep {
  return {
    idx,
    intent: "click",
    action: "click",
    selectors,
    target: "",
    valueSource: "none",
    value: "",
    inputKey: "",
    key: "",
  };
}

beforeAll(async () => {
  await ready();
});

describe("self-healing skills (learnSelectors)", () => {
  it("promotes an operator-found selector to best-first, dedups, and is idempotent", async () => {
    const s = await createSkill({ owner: "HEAL_O", generalized: GEN, sourceDemoId: null });
    await updateSkill(s.id, {
      name: s.name,
      description: s.description,
      plan: [step(0, ["#old"]), step(1, ["#keep"])],
      inputSchema: s.inputSchema,
    });

    // step 0 healed to "#new"; step 1 unchanged
    expect(await learnSelectors(s.id, { 0: "#new" })).toBe(1);
    let got = await getSkill(s.id);
    expect(got!.plan[0].selectors).toEqual(["#new", "#old"]); // new is best-first, old retained
    expect(got!.plan[1].selectors).toEqual(["#keep"]);

    // healing with the SAME selector again → no change
    expect(await learnSelectors(s.id, { 0: "#new" })).toBe(0);

    // healing to a selector already present moves it to front without duplicating
    expect(await learnSelectors(s.id, { 0: "#old" })).toBe(1);
    got = await getSkill(s.id);
    expect(got!.plan[0].selectors).toEqual(["#old", "#new"]);
  });
});
