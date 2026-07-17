import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  createSkill,
  setPublished,
  unpublishableReason,
  SkillNotPublishableError,
} from "../../lib/skills";
import type { GeneralizedSkill, Skill } from "../../lib/types";

const OWNER = "WALLET_PUB";
const goodStep = { intent: "open", action: "navigate" as const, selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none" as const, value: "", inputKey: "", key: "" };

function gen(over: Partial<GeneralizedSkill> = {}): GeneralizedSkill {
  return { name: "Pub", description: "", inputFields: [], steps: [goodStep], ...over };
}

beforeAll(async () => {
  await ready();
});

describe("publish validation (unrunnable skills can't go to market)", () => {
  it("unpublishableReason flags an empty plan and bad input bindings", () => {
    const base = { plan: [goodStep], inputSchema: { fields: [{ key: "vendor", label: "V", example: "" }] } } as unknown as Skill;
    expect(unpublishableReason(base)).toBeNull();
    expect(unpublishableReason({ ...base, plan: [] } as Skill)).toMatch(/no steps/i);
    // an `input` step whose key isn't a declared field
    const badBinding = {
      ...base,
      plan: [{ ...goodStep, valueSource: "input", inputKey: "missing" }],
    } as unknown as Skill;
    expect(unpublishableReason(badBinding)).toMatch(/isn't one of/i);
    // an `input` step matching a real field is fine
    const okBinding = {
      ...base,
      plan: [{ ...goodStep, valueSource: "input", inputKey: "vendor" }],
    } as unknown as Skill;
    expect(unpublishableReason(okBinding)).toBeNull();
  });

  it("setPublished refuses a skill with no steps", async () => {
    const empty = await createSkill({ owner: OWNER, generalized: gen({ steps: [] }), sourceDemoId: null });
    await expect(setPublished(empty.id, OWNER, true)).rejects.toBeInstanceOf(SkillNotPublishableError);
    // a runnable skill publishes fine
    const good = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    expect(await setPublished(good.id, OWNER, true)).toBe(true);
  });
});
