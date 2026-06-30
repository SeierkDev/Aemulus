import { executeRun } from "./runner";
import { createRun, getRun } from "./runs";
import { incrementRunCount } from "./skills";
import { invalidateReputation } from "./reputation";
import { creditEarningOnce } from "./earnings";
import { dispatchRunEvent, eventForStatus } from "./webhooks";
import { enqueueRunJob } from "./jobs";
import { SOLANA } from "./solana";
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
  // Durable: enqueue for the worker instead of executing in-request, so the run
  // survives a restart and retries transient failures.
  await enqueueRunJob({
    runId: run.id,
    runner: args.runner,
    skillId: args.skill.id,
    input: args.input,
    overrides: args.overrides ?? {},
  });
  return run; // status: "running"
}

/**
 * Execute a run and do the post-run bookkeeping (counts, earnings, webhook).
 * THROWS on an infrastructure failure (e.g. the browser can't launch) so the
 * job worker can retry it; a run that merely ends failed/needs_review returns
 * normally (that's a real outcome, not something to retry). Exported for the
 * worker and for tests.
 */
const TERMINAL = new Set(["completed", "failed", "needs_review"]);

export async function completeRun(runId: string, args: RunArgs): Promise<void> {
  // Idempotency guard: if a job is requeued by recoverStuckJobs (worker crash or
  // a slow finalize) AFTER the run already finished, it can be re-claimed. Don't
  // re-execute the browser run or re-fire bookkeeping/webhooks/metrics for a run
  // that already reached a terminal state — just let the worker mark the job done.
  const prior = await getRun(runId);
  if (prior && TERMINAL.has(prior.status)) return;

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
  // runner" rule is the anti-Sybil guard - see hasEarnedFrom.
  if (
    final.status === "completed" &&
    args.skill.owner &&
    args.skill.owner !== args.runner
  ) {
    // Atomic credit-once per (skill, runner): the anti-Sybil first-run rule,
    // safe against two concurrent completions racing a check-then-insert.
    await creditEarningOnce({
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
  // Output destination: a data-only event, fired only when the run actually
  // captured something — so a results endpoint isn't spammed by empty runs.
  if (final.output && Object.keys(final.output).length > 0) {
    await dispatchRunEvent(args.runner, "run.output", {
      runId,
      skillId: args.skill.id,
      output: final.output,
      at: final.updatedAt,
    });
  }
}
