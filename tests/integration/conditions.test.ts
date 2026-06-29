import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, updateSkill, getSkill } from "../../lib/skills";
import type { GeneralizedSkill, SkillStep } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "C", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("conditional (branching) steps", () => {
  it("persists a step's run-condition through update + get", async () => {
    const s = await createSkill({ owner: "COND_O", generalized: GEN, sourceDemoId: null });
    const step: SkillStep = {
      idx: 0,
      intent: "Dismiss cookie banner",
      action: "click",
      selectors: ["#accept"],
      target: "",
      valueSource: "none",
      value: "",
      inputKey: "",
      key: "",
      condition: { kind: "exists", selector: "#cookie-banner" },
    };
    await updateSkill(s.id, {
      name: s.name,
      description: s.description,
      plan: [step],
      inputSchema: s.inputSchema,
    });
    const got = await getSkill(s.id);
    expect(got!.plan[0].condition).toEqual({
      kind: "exists",
      selector: "#cookie-banner",
    });
  });
});
