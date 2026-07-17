import { beforeAll, describe, expect, it, vi } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, setPublished, getSkill } from "../../lib/skills";
import { reportSkill, countReports, isVerified } from "../../lib/moderation";
import { createTrigger, resolveTrigger, listTriggers } from "../../lib/triggers";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = {
  name: "M",
  description: "",
  inputFields: [],
  // A publishable skill needs at least one runnable step.
  steps: [{ intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" }],
};

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

  it("takedown is a kill-switch: it deactivates the skill's triggers", async () => {
    const skill = await createSkill({ owner: "KS_OWNER", generalized: GEN, sourceDemoId: null });
    await setPublished(skill.id, "KS_OWNER", true);
    const trig = await createTrigger("KS_OWNER", skill.id);
    expect(await resolveTrigger(trig.token)).not.toBeNull(); // active before takedown

    await reportSkill(skill.id, "KR1", "x");
    await reportSkill(skill.id, "KR2", "x");
    const res = await reportSkill(skill.id, "KR3", "x"); // 3rd distinct → takedown
    expect(res.tookDown).toBe(true);

    expect(await resolveTrigger(trig.token)).toBeNull(); // trigger deactivated
    expect(await listTriggers("KS_OWNER", skill.id)).toHaveLength(0);
  });

  it("isVerified returns true for a wallet in the configured allowlist", async () => {
    // VERIFIED is built from env at module load, so re-import with the env set.
    vi.resetModules();
    process.env.AEMULUS_VERIFIED = "WALLET_A, WALLET_B";
    const mod = await import("../../lib/moderation");
    expect(mod.isVerified("WALLET_A")).toBe(true);
    expect(mod.isVerified("WALLET_B")).toBe(true);
    expect(mod.isVerified("WALLET_C")).toBe(false);
    delete process.env.AEMULUS_VERIFIED;
    vi.resetModules();
  });
});
