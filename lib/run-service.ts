import { executeRun } from "./runner";
import { createRun, finishRun } from "./runs";
import { incrementRunCount } from "./skills";
import { invalidateReputation } from "./reputation";
import { creditEarning } from "./earnings";
import { SOLANA } from "./solana";
import { logError } from "./log";
import type { Run, RunOverrides, Skill } from "./types";

interface RunArgs {
  skill: Skill;
  input: Record<string, string>;
  overrides?: RunOverrides;
  runner: string;
}

/**
 * Start a run asynchronously: create the row as "running" and return it
 * immediately, then execute in the background. Concurrency is bounded inside
 * executeRun via the run-slot semaphore (excess runs queue). Callers (the run
 * API, resolve, the scheduler) get a run id instantly and the UI polls for
 * progress. The creator is credited a run fee on external (non-owner) runs.
 */
export async function startRun(args: RunArgs): Promise<Run> {
  const run = await createRun({
    owner: args.runner,
    skillId: args.skill.id,
    input: args.input,
    overrides: args.overrides ?? {},
  });
  void completeRun(run.id, args);
  return run; // status: "running"
}

async function completeRun(runId: string, args: RunArgs): Promise<void> {
  try {
    await executeRun(
      args.skill,
      runId,
      args.runner,
      args.input,
      args.overrides ?? {},
    );
    await incrementRunCount(args.skill.id);
    invalidateReputation(args.skill.id); // success-rate aggregate changed
    if (args.skill.owner && args.skill.owner !== args.runner) {
      await creditEarning({
        owner: args.skill.owner,
        skillId: args.skill.id,
        runId,
        runner: args.runner,
        amount: SOLANA.runFee,
      });
    }
  } catch (e) {
    logError("run.complete", e, { run: runId });
    await finishRun(runId, {
      status: "failed",
      error: e instanceof Error ? e.message : "Run failed",
    }).catch(() => {});
  }
}
