import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, updateSkill } from "../../lib/skills";
import { getRun } from "../../lib/runs";
import { startChainedRun, childInput, planHasChaining } from "../../lib/chain";
import type { GeneralizedSkill, SkillStep } from "../../lib/types";

const OWNER = "CHAIN_O";
const gen = (name: string, fields: { key: string; label: string; example: string }[] = []): GeneralizedSkill => ({
  name,
  description: "",
  inputFields: fields,
  steps: [],
});

beforeAll(async () => {
  await ready();
});

describe("childInput mapping", () => {
  it("fills child fields from parent outputs first, then parent input", () => {
    const fields = [
      { key: "email", label: "Email", example: "" },
      { key: "name", label: "Name", example: "" },
      { key: "missing", label: "M", example: "" },
    ];
    const mapped = childInput(fields, { name: "Ann", email: "in@x.com" }, { email: "out@x.com" });
    expect(mapped).toEqual({ email: "out@x.com", name: "Ann" }); // output wins; missing omitted
  });
});

describe("startChainedRun", () => {
  it("starts a child run of the sub-skill with mapped input", async () => {
    const parent = await createSkill({ owner: OWNER, generalized: gen("Parent"), sourceDemoId: null });
    const sub = await createSkill({
      owner: OWNER,
      generalized: gen("Sub", [{ key: "email", label: "Email", example: "" }]),
      sourceDemoId: null,
    });
    const res = await startChainedRun({
      parentSkillId: parent.id,
      subSkillId: sub.id,
      owner: OWNER,
      parentInput: {},
      parentOutputs: { email: "captured@x.com" },
    });
    expect("runId" in res).toBe(true);
    if ("runId" in res) {
      const child = await getRun(res.runId);
      expect(child!.skillId).toBe(sub.id);
      expect(child!.input).toEqual({ email: "captured@x.com" });
    }
  });

  it("refuses self-chaining, unknown skills, and nested chains", async () => {
    const a = await createSkill({ owner: OWNER, generalized: gen("A"), sourceDemoId: null });
    expect(await startChainedRun({ parentSkillId: a.id, subSkillId: a.id, owner: OWNER, parentInput: {}, parentOutputs: {} })).toEqual({ skipped: "a skill can't chain to itself" });
    expect(await startChainedRun({ parentSkillId: a.id, subSkillId: "skl_nope", owner: OWNER, parentInput: {}, parentOutputs: {} })).toEqual({ skipped: "sub-skill not found" });

    // a sub-skill that itself chains -> nested, refused
    const nested = await createSkill({ owner: OWNER, generalized: gen("Nested"), sourceDemoId: null });
    const chainStep: SkillStep = {
      idx: 0, intent: "chain", action: "run_skill", selectors: [], target: "",
      valueSource: "none", value: "", inputKey: "", key: "", subSkillId: a.id,
    };
    await updateSkill(nested.id, { name: "Nested", description: "", plan: [chainStep], inputSchema: { fields: [] } });
    expect(planHasChaining([chainStep])).toBe(true);
    expect(await startChainedRun({ parentSkillId: a.id, subSkillId: nested.id, owner: OWNER, parentInput: {}, parentOutputs: {} })).toEqual({ skipped: "nested chaining is not allowed" });
  });
});
