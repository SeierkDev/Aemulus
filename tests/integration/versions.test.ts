import { beforeAll, describe, expect, it } from "vitest";
import { ready, db } from "../../lib/db";
import {
  createSkill,
  getSkill,
  updateSkill,
  listSkillVersions,
  restoreSkillVersion,
} from "../../lib/skills";
import { createRun, finishRun } from "../../lib/runs";
import { creditEarning } from "../../lib/earnings";
import { getCreatorAnalytics } from "../../lib/analytics";
import type { GeneralizedSkill } from "../../lib/types";

const OWNER = "WALLET_VERS";

function gen(name = "V1"): GeneralizedSkill {
  return {
    name,
    description: "d",
    inputFields: [],
    steps: [
      {
        intent: "open",
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
}

beforeAll(async () => {
  await ready();
});

describe("skill row robustness", () => {
  it("getSkill survives a corrupt plan column (returns empty, not a 500)", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen("Corrupt"), sourceDemoId: null });
    // Simulate a corrupt/truncated JSON column (the `|| "[]"` fallback only
    // covers NULL/empty, not malformed JSON).
    await db.execute({
      sql: `UPDATE skills SET plan = ?, allowed_hosts = ? WHERE id = ?`,
      args: ["[{ broken", "not json", skill.id],
    });
    const got = await getSkill(skill.id);
    expect(got).not.toBeNull();
    expect(got!.plan).toEqual([]);
    expect(got!.allowedHosts).toEqual([]);
  });
});

describe("skill versioning", () => {
  it("snapshots on create + update, and restores a prior version", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen("Name v1"), sourceDemoId: null });
    expect(skill.version).toBe(1);
    expect(await listSkillVersions(skill.id)).toHaveLength(1);

    await updateSkill(skill.id, {
      name: "Name v2",
      description: "d2",
      plan: skill.plan,
      inputSchema: skill.inputSchema,
    });
    const v2 = await getSkill(skill.id);
    expect(v2!.version).toBe(2);
    expect(v2!.name).toBe("Name v2");
    expect(await listSkillVersions(skill.id)).toHaveLength(2);

    // restore v1 → content reverts, recorded as a new version (3)
    expect(await restoreSkillVersion(skill.id, 1)).toBe(true);
    const restored = await getSkill(skill.id);
    expect(restored!.name).toBe("Name v1");
    expect(restored!.version).toBe(3);
    expect(await listSkillVersions(skill.id)).toHaveLength(3);
  });
});

describe("creator analytics", () => {
  it("reports a 14-day window of runs + earnings for a creator's skills", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen("Earner"), sourceDemoId: null });
    for (const status of ["completed", "completed", "failed"] as const) {
      const r = await createRun({ owner: "RUNNER", skillId: skill.id, input: {} });
      await finishRun(r.id, { status, result: null, error: null });
    }
    await creditEarning({
      owner: OWNER,
      skillId: skill.id,
      runId: "run_x",
      runner: "RUNNER",
      amount: 20,
    });

    const a = await getCreatorAnalytics(OWNER);
    expect(a.days).toHaveLength(14);
    expect(a.windowRuns).toBeGreaterThanOrEqual(3);
    expect(a.windowSuccess).toBeGreaterThan(0);
    expect(a.windowEarnings).toBeGreaterThanOrEqual(20);
    // today's bucket (last) should hold the activity
    expect(a.days[a.days.length - 1].earnings).toBeGreaterThanOrEqual(20);
  });
});
