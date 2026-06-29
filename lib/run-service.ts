import { executeRun } from "./runner";
import { createRun, finishRun } from "./runs";
import { incrementRunCount } from "./skills";
import { invalidateReputation } from "./reputation";
import { creditEarning, hasEarnedFrom } from "./earnings";
import { dispatchRunEvent, eventForStatus } from "./webhooks";
import { SOLANA } from "./solana";
import { logError } from "./log";
import { incr } from "./metrics";
import type { Run, RunOverrides, Skill } from "./types";

interface RunArgs {
  skill: Skill;
  input: Record<string, string>;
  overrides?: RunOverrides;
  runner: string;
  bulkId?: string;
  rowIndex?: number;
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
    bulkId: args.bulkId,
    rowIndex: args.rowIndex,
  });
  incr("runs.started");
  void completeRun(run.id, args);
  return run; // status: "running"
}

/** Exported for tests — the await-able core that startRun fires in background. */
export async function completeRun(runId: string, args: RunArgs): Promise<void> {
  try {
    const final = await executeRun(
      args.skill,
      runId,
      args.runner,
      args.input,
      args.overrides ?? {},
    );
    incr(`runs.${final.status}`); // runs.completed / needs_review / failed
    await incrementRunCount(args.skill.id);
    invalidateReputation(args.skill.id); // success-rate aggregate changed
    // Pay the creator only for: a completed run, by someone other than the
    // owner, who hasn't run this skill before. The "first run per distinct
    // runner" rule is the anti-Sybil guard — see hasEarnedFrom.
    if (
      final.status === "completed" &&
      args.skill.owner &&
      args.skill.owner !== args.runner &&
      !(await hasEarnedFrom(args.skill.id, args.runner))
    ) {
      await creditEarning({
        owner: args.skill.owner,
        skillId: args.skill.id,
        runId,
        runner: args.runner,
        amount: SOLANA.runFee,
      });
    }
    await dispatchRunEvent(args.runner, eventForStatus(final.status), {
      runId,
      skillId: args.skill.id,
      status: final.status,
      output: final.output,
      receiptHash: final.receiptHash,
      at: final.updatedAt,
    });
  } catch (e) {
    incr("runs.failed");
    logError("run.complete", e, { run: runId });
    await dispatchRunEvent(args.runner, "run.failed", {
      runId,
      skillId: args.skill.id,
      status: "failed",
      at: Date.now(),
    }).catch(() => {});
    await finishRun(runId, {
      status: "failed",
      error: e instanceof Error ? e.message : "Run failed",
    }).catch(() => {});
  }
}
