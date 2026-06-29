import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the runner so completeRun's executeRun returns a chosen status without
// launching a browser. (Replaces the whole module → playwright isn't imported.)
vi.mock("../../lib/runner", () => ({ executeRun: vi.fn() }));

import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createRun } from "../../lib/runs";
import { completeRun } from "../../lib/run-service";
import { getEarningsSummary } from "../../lib/earnings";
import { executeRun } from "../../lib/runner";
import { SOLANA } from "../../lib/solana";
import type { GeneralizedSkill, Run, RunStatus, Skill } from "../../lib/types";

const mockExec = vi.mocked(executeRun);
const GEN: GeneralizedSkill = {
  name: "T",
  description: "",
  inputFields: [],
  steps: [],
};

function returns(status: RunStatus) {
  mockExec.mockResolvedValue({
    id: "x",
    status,
    output: null,
    receiptHash: null,
    updatedAt: Date.now(),
  } as unknown as Run);
}

async function runOnce(skill: Skill, runner: string): Promise<void> {
  const run = await createRun({
    owner: runner,
    skillId: skill.id,
    input: {},
    overrides: {},
  });
  await completeRun(run.id, { skill, input: {}, runner });
}

beforeAll(async () => {
  await ready();
});
beforeEach(() => mockExec.mockReset());

describe("completeRun creator credit rules", () => {
  it("credits the creator the run fee on a completed EXTERNAL run", async () => {
    const skill = await createSkill({
      owner: "CREATOR_A",
      generalized: GEN,
      sourceDemoId: null,
    });
    returns("completed");
    await runOnce(skill, "RUNNER_X");
    expect((await getEarningsSummary("CREATOR_A")).total).toBe(SOLANA.runFee);
  });

  it("does NOT credit when the owner runs their own skill", async () => {
    const skill = await createSkill({
      owner: "CREATOR_B",
      generalized: GEN,
      sourceDemoId: null,
    });
    returns("completed");
    await runOnce(skill, "CREATOR_B"); // runner === owner
    expect((await getEarningsSummary("CREATOR_B")).total).toBe(0);
  });

  it("does NOT credit for failed or needs_review runs", async () => {
    const skill = await createSkill({
      owner: "CREATOR_C",
      generalized: GEN,
      sourceDemoId: null,
    });
    returns("failed");
    await runOnce(skill, "RUNNER_X");
    returns("needs_review");
    await runOnce(skill, "RUNNER_X");
    expect((await getEarningsSummary("CREATOR_C")).total).toBe(0);
  });

  it("credits a runner only ONCE per skill (anti-Sybil), but a new runner does credit", async () => {
    const skill = await createSkill({
      owner: "CREATOR_D",
      generalized: GEN,
      sourceDemoId: null,
    });
    returns("completed");
    await runOnce(skill, "RUNNER_Y"); // first run by Y → credit
    await runOnce(skill, "RUNNER_Y"); // repeat by Y → NO extra credit
    expect((await getEarningsSummary("CREATOR_D")).total).toBe(SOLANA.runFee);

    await runOnce(skill, "RUNNER_Z"); // a distinct runner → credit
    expect((await getEarningsSummary("CREATOR_D")).total).toBe(
      SOLANA.runFee * 2,
    );
  });
});
