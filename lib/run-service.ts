import { executeRun } from "./runner";
import {
  createRun,
  getRun,
  finishRun,
  claimRunBookkeeping,
  isRunBookkept,
  setRunRegistryAnchor,
  setRunZkAnchor,
} from "./runs";
import { incrementRunCount, templateTool } from "./skills";
import { invalidateReputation } from "./reputation";
import { creditEarningOnce } from "./earnings";
import { evaluateWatchForRun } from "./watch-runner";
import { activeSink } from "./watch-sink-telegram";
import { dispatchRunEvent, eventForStatus } from "./webhooks";
import { alertRunFinished, alertRunNeverStarted } from "./run-alert-telegram";
import { recordRunOnChain, registryEnabled } from "./registry";
import { recordRunCompressed, zkReceiptsEnabled } from "./zk-receipts";
import { enqueueRunJob } from "./jobs";
import { SOLANA } from "./solana";
import { incr } from "./metrics";
import { logError } from "./log";
import type { QuotaReserve } from "./runs";
import type { Run, RunOverrides, Skill } from "./types";

interface RunArgs {
  skill: Skill;
  input: Record<string, string>;
  overrides?: RunOverrides;
  runner: string;
  bulkId?: string;
  rowIndex?: number;
  /** A scheduled watch check. Metered against the watch allowance and executed
   *  without the vision verifier, which a watch has no use for. */
  isWatch?: boolean;
  /** The schedule that fired this run. Set by the scheduler so that when the
   *  run settles, a watch attached to that schedule can be found. */
  scheduleId?: string;
  /**
   * Optional atomic daily-quota reservation. When set, the run is created only
   * if the caller is still under the limit (race-free); over quota throws
   * QuotaExceededError. Omit for paths that don't meter (the owner's own
   * schedule, a bulk batch metered once upfront).
   */
  quota?: QuotaReserve;
}

/** The atomic quota reserve refused the run (caller already at the daily cap). */
export class QuotaExceededError extends Error {
  constructor() {
    super("Daily run quota reached");
    this.name = "QuotaExceededError";
  }
}

/** A marketplace template can't be run - it's a starter to record your own from. */
export class TemplateSkillError extends Error {
  constructor(tool: string) {
    super(`This is a template for ${tool}. Record your own version to run it.`);
    this.name = "TemplateSkillError";
  }
}

/**
 * Start a run asynchronously: create the row as "running" and return it
 * immediately, then execute in the background. Concurrency is bounded inside
 * executeRun via the run-slot semaphore (excess runs queue). Callers (the run
 * API, resolve, the scheduler) get a run id instantly and the UI polls for
 * progress. The creator is credited a run fee on external (non-owner) runs.
 */
export async function startRun(args: RunArgs): Promise<Run> {
  // A marketplace template has placeholder steps and isn't runnable - refuse
  // before creating a run row (defense-in-depth; the UI hides run controls too).
  const tmpl = templateTool(args.skill);
  if (tmpl) throw new TemplateSkillError(tmpl);
  const base = {
    owner: args.runner,
    skillId: args.skill.id,
    input: args.input,
    overrides: args.overrides ?? {},
    bulkId: args.bulkId,
    rowIndex: args.rowIndex,
    scheduleId: args.scheduleId,
    // Stamped now, from the skill as it stands at this moment. Read later it
    // would be whatever the skill has since been edited or healed into, which
    // is exactly the question analytics is trying to answer.
    skillVersion: args.skill.version,
    isWatch: args.isWatch,
  };
  // Branch so each call resolves a concrete createRun overload (metered → may
  // return null; unmetered → always a Run).
  const run = args.quota
    ? await createRun({ ...base, reserve: args.quota })
    : await createRun(base);
  // Atomic reserve refused it: the caller passed getQuota()'s soft check but a
  // concurrent burst filled the last slot(s) first. Nothing was inserted.
  if (!run) throw new QuotaExceededError();
  incr("runs.started");
  // Durable: enqueue for the worker instead of executing in-request, so the run
  // survives a restart and retries transient failures. If the enqueue write itself
  // fails, the run row already exists as "running" with no job to settle it — mark
  // it failed so it doesn't strand in "running" forever (recoverStuckJobs only
  // reconciles the jobs table, not runs that never got a job).
  try {
    await enqueueRunJob({
      runId: run.id,
      runner: args.runner,
      skillId: args.skill.id,
      input: args.input,
      overrides: args.overrides ?? {},
    });
  } catch (e) {
    await finishRun(run.id, { status: "failed", error: "Could not queue the run." }).catch(() => {});
    // The throw reaches the caller, which for a scheduled run is the scheduler
    // and not the person whose schedule just produced nothing.
    void alertRunNeverStarted(run.id, args.skill.name).catch(() => {});
    throw e;
  }
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
  // Idempotency guard: if a job is requeued by recoverStuckJobs (worker crash or a
  // slow finalize) AFTER the run already finished, it can be re-claimed. A terminal
  // run must not RE-execute the browser — but we must still distinguish:
  //   - terminal AND already bookkept → fully done; let the worker mark the job done.
  //   - terminal but NOT bookkept → the worker crashed between finishRun() and the
  //     bookkeeping below (a multi-second window: executeRun does a post-finish
  //     verifyOutcome LLM call before returning). Skip re-execution but STILL run the
  //     once-latched bookkeeping, or the completed run silently loses its
  //     earnings/run_count/webhook forever (no reconciler scans for this).
  const prior = await getRun(runId);
  const alreadyTerminal = !!prior && TERMINAL.has(prior.status);
  if (alreadyTerminal && (await isRunBookkept(runId))) return;

  const final = alreadyTerminal
    ? prior! // alreadyTerminal ⇒ prior is non-null
    : await executeRun(
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
  await finalizeRunAccounting(runId, args.skill, args.runner, final);
}

/**
 * Post-run bookkeeping shared by BOTH execution backends — the cloud Playwright
 * runner (completeRun above) and the browser-extension runner (which does the
 * actual clicking in the user's own browser, then reports the terminal run here
 * to be settled the same way). Single source of truth for: the exactly-once
 * latch, marketplace run_count, creator earnings, webhooks, and on-chain anchors.
 * Call it AFTER the run has reached a terminal status and its receipt is attached.
 */
export async function finalizeRunAccounting(
  runId: string,
  skill: Skill,
  runner: string,
  final: Run,
): Promise<void> {
  // Exactly-once latch: two executions (a requeued job, or a duplicate finish)
  // must not double-count. Only the latch winner runs the rest.
  // Creator credit + marketplace popularity count only a COMPLETED run by someone
  // OTHER than the owner (an owner can't inflate their own earnings/ranking).
  //
  // Do this BEFORE the at-most-once latch. creditEarningOnce is idempotent (at
  // most one earnings row per (skill, runner); returns true ONLY when it actually
  // writes), so running it on every finalize attempt is safe — and crucially, a
  // transient DB error here retries cleanly on the next completeRun pass instead
  // of latching the run as "done" with the creator's credit permanently lost.
  // The run_count bump is tied to the SAME fresh-credit signal, so credit and
  // count happen exactly once together — even under a concurrent re-execution,
  // since SQLite serializes the insert and only one caller sees credited === true.
  if (final.status === "completed" && skill.owner && skill.owner !== runner) {
    const credited = await creditEarningOnce({
      owner: skill.owner,
      skillId: skill.id,
      runId,
      runner,
      amount: SOLANA.runFee,
    });
    if (credited) await incrementRunCount(skill.id);
  }
  // At-most-once latch for the remaining, non-idempotent side effects (metrics,
  // webhooks, on-chain anchors). If this run was already bookkept, skip them —
  // the idempotent credit above already ran, so nothing is lost.
  if (!(await claimRunBookkeeping(runId))) return;
  incr(`runs.${final.status}`); // runs.completed / needs_review / failed
  invalidateReputation(skill.id); // success-rate aggregate changed (any terminal status)
  // Best-effort, fire-and-forget webhook delivery (never blocks settling). The
  // status event carries no output; extracted data goes only via run.output.
  void dispatchRunEvent(runner, eventForStatus(final.status), {
    runId,
    skillId: skill.id,
    status: final.status,
    receiptHash: final.receiptHash,
    at: final.updatedAt,
  }).catch(() => {});
  // A watch on this run's schedule, if it has one. Fire-and-forget for the same
  // reason as the webhooks above: the run has already settled and its receipt is
  // attached, so a watch must never be able to break settlement.
  void evaluateWatchForRun(final, activeSink()).catch(() => {});
  // And tell the owner directly when the run itself needs them. Excludes watch
  // runs, which speak through their own rule — two messages for one event is
  // how a bot gets muted, and a muted bot takes the watch alerts with it.
  void alertRunFinished(final, skill.name).catch(() => {});
  if (final.output && Object.keys(final.output).length > 0) {
    void dispatchRunEvent(runner, "run.output", {
      runId,
      skillId: skill.id,
      output: final.output,
      at: final.updatedAt,
    }).catch(() => {});
  }
  // On-chain anchors (gated/inert unless configured), best-effort + fire-and-forget.
  if (final.status === "completed" && final.receiptHash && registryEnabled()) {
    void recordRunOnChain(skill, final)
      .then((res) => {
        if (res) return setRunRegistryAnchor(runId, res.sig, res.cluster);
      })
      .catch((e) => logError("registry.record", e));
  }
  if (final.status === "completed" && final.receiptHash && zkReceiptsEnabled()) {
    void recordRunCompressed(final)
      .then((res) => {
        if (res) return setRunZkAnchor(runId, res.sig, res.address, res.cluster);
      })
      .catch((e) => logError("zk.record", e));
  }
}
