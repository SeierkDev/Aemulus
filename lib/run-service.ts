import { executeRun } from "./runner";
import {
  createRun,
  getRun,
  claimRunBookkeeping,
  setRunRegistryAnchor,
  setRunZkAnchor,
} from "./runs";
import { incrementRunCount } from "./skills";
import { invalidateReputation } from "./reputation";
import { creditEarningOnce } from "./earnings";
import { dispatchRunEvent, eventForStatus } from "./webhooks";
import { recordRunOnChain, registryEnabled } from "./registry";
import { recordRunCompressed, zkReceiptsEnabled } from "./zk-receipts";
import { enqueueRunJob } from "./jobs";
import { SOLANA } from "./solana";
import { incr } from "./metrics";
import { logError } from "./log";
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
  // Exactly-once latch: the terminal short-circuit above stops a SEQUENTIAL
  // re-run, but two executions can still run CONCURRENTLY (a job requeued while
  // a multi-checkpoint run is still alive). Only the latch winner does the
  // counts/credit/webhooks, so they fire exactly once regardless.
  if (!(await claimRunBookkeeping(runId))) return;
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
  // Webhook delivery is best-effort and MUST NOT block the run/job from settling
  // (a slow or dead subscriber would otherwise hold a worker slot). Fire-and-
  // forget — the worker process is long-lived so the deliveries still run.
  // The status event carries NO output: extracted data is delivered only via the
  // opt-in run.output event, so a status-only subscriber doesn't receive it.
  void dispatchRunEvent(args.runner, eventForStatus(final.status), {
    runId,
    skillId: args.skill.id,
    status: final.status,
    receiptHash: final.receiptHash,
    at: final.updatedAt,
  }).catch(() => {});
  // Output destination: a data-only event, fired only when the run actually
  // captured something — so a results endpoint isn't spammed by empty runs.
  if (final.output && Object.keys(final.output).length > 0) {
    void dispatchRunEvent(args.runner, "run.output", {
      runId,
      skillId: args.skill.id,
      output: final.output,
      at: final.updatedAt,
    }).catch(() => {});
  }

  // On-chain registry anchor (gated/inert unless configured): record a completed
  // run's receipt via the aemulus-registry program, then store the tx signature.
  // Best-effort + fire-and-forget — a chain hiccup never affects the run.
  if (final.status === "completed" && final.receiptHash && registryEnabled()) {
    void recordRunOnChain(args.skill, final)
      .then((res) => {
        if (res) return setRunRegistryAnchor(runId, res.sig, res.cluster);
      })
      .catch((e) => logError("registry.record", e));
  }

  // ZK-compressed receipt anchor (gated/inert unless configured): the same
  // receipt recorded ~100x cheaper as a Light compressed account. Independent
  // of the registry above; also best-effort + fire-and-forget.
  if (final.status === "completed" && final.receiptHash && zkReceiptsEnabled()) {
    void recordRunCompressed(final)
      .then((res) => {
        if (res) return setRunZkAnchor(runId, res.sig, res.address, res.cluster);
      })
      .catch((e) => logError("zk.record", e));
  }
}
