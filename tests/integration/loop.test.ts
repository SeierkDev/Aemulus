import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, updateSkill, getSkill } from "../../lib/skills";
import type { GeneralizedSkill, SkillStep } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "L", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("in-skill loop (repeating extract)", () => {
  it("persists the loop flag on an extract step", async () => {
    const s = await createSkill({ owner: "LOOP_O", generalized: GEN, sourceDemoId: null });
    const step: SkillStep = {
      idx: 0,
      intent: "Capture every price",
      action: "extract",
      selectors: [".price"],
      target: "",
      valueSource: "none",
      value: "",
      inputKey: "",
      key: "",
      outputKey: "prices",
      loop: true,
    };
    await updateSkill(s.id, {
      name: s.name,
      description: s.description,
      plan: [step],
      inputSchema: s.inputSchema,
    });
    const got = await getSkill(s.id);
    expect(got!.plan[0].loop).toBe(true);
    expect(got!.plan[0].outputKey).toBe("prices");
  });
});
