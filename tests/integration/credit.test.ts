import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the runner so completeRun's executeRun returns a chosen status without
// launching a browser. (Replaces the whole module → playwright isn't imported.)
vi.mock("../../lib/runner", () => ({ executeRun: vi.fn() }));

import { ready } from "../../lib/db";
import { createSkill, getSkill } from "../../lib/skills";
import { createRun, finishRun, getRun, claimRunBookkeeping, isFirstCompletedRunByRunner } from "../../lib/runs";
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

  it("already-terminal AND bookkept: no re-execution, no re-credit", async () => {
    const skill = await createSkill({ owner: "CREATOR_DUP", generalized: GEN, sourceDemoId: null });
    const run = await createRun({ owner: "RUNNER_X", skillId: skill.id, input: {}, overrides: {} });
    await finishRun(run.id, { status: "completed", result: "done" });
    await claimRunBookkeeping(run.id); // bookkeeping already ran
    returns("completed"); // would credit if the run executed again
    await completeRun(run.id, { skill, input: {}, runner: "RUNNER_X" });
    expect(mockExec).not.toHaveBeenCalled(); // short-circuited, no second execution
    expect((await getEarningsSummary("CREATOR_DUP")).total).toBe(0); // no double credit
  });

  it("terminal but NOT bookkept (crash window): recovers bookkeeping once, without re-executing", async () => {
    // A worker crash between finishRun() and the bookkeeping block leaves a completed
    // run bookkept=0. A recovered job must NOT re-run the browser, but MUST still run
    // the once-latched bookkeeping so the completed run isn't robbed of its credit.
    const skill = await createSkill({ owner: "CREATOR_CRASH", generalized: GEN, sourceDemoId: null });
    const run = await createRun({ owner: "RUNNER_CR", skillId: skill.id, input: {}, overrides: {} });
    await finishRun(run.id, { status: "completed", result: "done" }); // finished; bookkeeping never ran
    returns("completed");
    await completeRun(run.id, { skill, input: {}, runner: "RUNNER_CR" });
    expect(mockExec).not.toHaveBeenCalled(); // no browser RE-execution
    expect((await getEarningsSummary("CREATOR_CRASH")).total).toBe(SOLANA.runFee); // credited exactly once
    expect((await getSkill(skill.id))!.runCount).toBe(1);
    // A further duplicate now finds it bookkept → no double credit.
    await completeRun(run.id, { skill, input: {}, runner: "RUNNER_CR" });
    expect((await getEarningsSummary("CREATOR_CRASH")).total).toBe(SOLANA.runFee);
  });

  it("bookkeeping fires exactly once if completeRun runs twice (latch)", async () => {
    // run_count is NOT otherwise idempotent, so it proves the latch: a recovered
    // duplicate execution of the same run must not double-count it.
    const skill = await createSkill({ owner: "CREATOR_LATCH", generalized: GEN, sourceDemoId: null });
    const run = await createRun({ owner: "RUNNER_L", skillId: skill.id, input: {}, overrides: {} });
    returns("completed");
    await completeRun(run.id, { skill, input: {}, runner: "RUNNER_L" });
    await completeRun(run.id, { skill, input: {}, runner: "RUNNER_L" }); // duplicate
    expect((await getSkill(skill.id))!.runCount).toBe(1);
    expect((await getEarningsSummary("CREATOR_LATCH")).total).toBe(SOLANA.runFee);
  });

  it("finishRun never moves a run OUT of a terminal state", async () => {
    const skill = await createSkill({
      owner: "CREATOR_TERM",
      generalized: GEN,
      sourceDemoId: null,
    });
    const run = await createRun({ owner: "RUNNER_T", skillId: skill.id, input: {}, overrides: {} });
    await finishRun(run.id, { status: "completed", result: "ok" });
    await finishRun(run.id, { status: "failed", error: "late clobber" });
    expect((await getRun(run.id))?.status).toBe("completed");
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

  it("run_count dedup rule: only a runner's FIRST completed run counts (anti-Sybil ranking)", async () => {
    // completeRun gates incrementRunCount on this, so one funded burner can't farm the
    // marketplace sort key by re-running (e.g. via a schedule). The caller's run is
    // already 'completed' in the DB at bookkeeping time (runner.ts:482), hence excluded.
    const skill = await createSkill({ owner: "CREATOR_RC", generalized: GEN, sourceDemoId: null });
    const r1 = await createRun({ owner: "BURNER", skillId: skill.id, input: {}, overrides: {} });
    expect(await isFirstCompletedRunByRunner(skill.id, "BURNER", r1.id)).toBe(true); // no prior completed
    await finishRun(r1.id, { status: "completed" });
    const r2 = await createRun({ owner: "BURNER", skillId: skill.id, input: {}, overrides: {} });
    expect(await isFirstCompletedRunByRunner(skill.id, "BURNER", r2.id)).toBe(false); // r1 already completed → farming
    const r3 = await createRun({ owner: "OTHER", skillId: skill.id, input: {}, overrides: {} });
    expect(await isFirstCompletedRunByRunner(skill.id, "OTHER", r3.id)).toBe(true); // a distinct adopter
  });
});
