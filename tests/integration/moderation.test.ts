import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, setPublished, getSkill } from "../../lib/skills";
import { reportSkill, countReports, isVerified } from "../../lib/moderation";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "M", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("marketplace moderation", () => {
  it("dedups reports per wallet and auto-unpublishes at the threshold (3)", async () => {
    const skill = await createSkill({ owner: "BADCREATOR", generalized: GEN, sourceDemoId: null });
    await setPublished(skill.id, "BADCREATOR", true);

    // same wallet twice → counts once
    await reportSkill(skill.id, "R1", "spam");
    await reportSkill(skill.id, "R1", "spam again");
    expect(await countReports(skill.id)).toBe(1);
    expect((await getSkill(skill.id))!.published).toBe(true);

    await reportSkill(skill.id, "R2", "bad");
    const second = await reportSkill(skill.id, "R3", "bad"); // 3rd distinct → takedown
    expect(second.reports).toBe(3);
    expect(second.tookDown).toBe(true);
    expect((await getSkill(skill.id))!.published).toBe(false);
  });

  it("isVerified reflects the configured set (empty by default)", () => {
    expect(isVerified("anyone")).toBe(false);
  });
});
