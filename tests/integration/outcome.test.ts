import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createRun, getRun, setRunOutcome } from "../../lib/runs";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "O", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("run outcome (vision success-verification)", () => {
  it("defaults to unchecked and persists a verdict", async () => {
    const skill = await createSkill({ owner: "OUT_O", generalized: GEN, sourceDemoId: null });
    const run = await createRun({ owner: "OUT_O", skillId: skill.id, input: {} });
    expect((await getRun(run.id))!.outcomeStatus).toBeNull();

    await setRunOutcome(run.id, "achieved", "Confirmation banner is visible.");
    const got = await getRun(run.id);
    expect(got!.outcomeStatus).toBe("achieved");
    expect(got!.outcomeReason).toBe("Confirmation banner is visible.");
  });
});
