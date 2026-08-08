import { getSkill } from "./skills";
import { completeRun } from "./run-service";
import { finishRun, getRun } from "./runs";
import { dispatchRunEvent } from "./webhooks";
import { alertRunFinished, alertRunNeverStarted } from "./run-alert-telegram";
import {
  claimNextJob,
  completeJob,
  failJob,
  recoverStuckJobs,
  pruneTerminalJobs,
  type Job,
} from "./jobs";
import { pruneIdempotencyKeys } from "./idempotency";
import { runSlots } from "./semaphore";
import { incr } from "./metrics";
import { logError, logInfo } from "./log";

/**
 * Job worker. Started once at boot (instrumentation.ts). Each tick it requeues
 * any jobs whose worker died mid-run, then claims and runs as many queued jobs
 * as there are free browser slots. A run that ends failed/needs_review is a
 * real outcome (job done); only an infra throw (e.g. browser launch) retries
 * with backoff, up to MAX_ATTEMPTS, after which the run is marked failed.
 */
const MAX_ATTEMPTS = 3;
const TICK_MS = 1500;
const RUN_TIMEOUT_MS = Number(process.env.AEMULUS_RUN_TIMEOUT_MS) || 120_000;
// A run can legitimately live FAR past RUN_TIMEOUT: each captcha pause (up to
// MAX_CAPTCHA_PAUSES) and each interactive live-takeover pause waits up to
// LIVE_TIMEOUT and extends the run's deadline. STALE_MS must exceed the worst-
// case alive time, or recoverStuckJobs would requeue a still-alive paused run
// mid-pause and start a SECOND concurrent execution of it (duplicating real
// side effects). Budget for every captcha pause plus a couple of interactive
// checkpoints. (locked_at is set once at claim and doesn't advance across pauses,
// so this constant is the only thing standing between a long pause and a
// double-execution; a per-pause heartbeat would let us shrink it.)
const LIVE_TIMEOUT_MS =
  Math.max(30_000, Number(process.env.AEMULUS_LIVE_TIMEOUT_MS) || 300_000);
const MAX_CAPTCHA_PAUSES = Math.max(
  0,
  Number(process.env.AEMULUS_CAPTCHA_MAX_PAUSES) || 3,
);
const STALE_MS =
  RUN_TIMEOUT_MS + (MAX_CAPTCHA_PAUSES + 2) * LIVE_TIMEOUT_MS + 120_000;

async function processJob(job: Job): Promise<void> {
  const skill = await getSkill(job.skillId);
  if (!skill) {
    await finishRun(job.runId, {
      status: "failed",
      error: "Skill no longer exists.",
    }).catch(() => {});
    await failJob(job.id, "skill removed", 0); // 0 attempts allowed → permanent
    incr("jobs.failed");
    // The only path here that does not even dispatch a webhook, so without this
    // a scheduled run whose skill was deleted fails on every channel silently.
    void alertRunNeverStarted(job.runId, "a skill that no longer exists").catch(() => {});
    return;
  }
  try {
    await completeRun(job.runId, {
      skill,
      input: job.input,
      overrides: job.overrides,
      runner: job.runner,
    });
    await completeJob(job.id, job.lockedAt);
    incr("jobs.done");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "run failed";
    const retried = await failJob(job.id, msg, MAX_ATTEMPTS, job.lockedAt);
    incr(retried ? "jobs.retried" : "jobs.failed");
    if (!retried) {
      // Out of retries - settle the run as failed and notify.
      await finishRun(job.runId, {
        status: "failed",
        error: `Run failed after ${MAX_ATTEMPTS} attempts: ${msg}`,
      }).catch(() => {});
      await dispatchRunEvent(job.runner, "run.failed", {
        runId: job.runId,
        skillId: job.skillId,
        status: "failed",
        at: Date.now(),
      }).catch(() => {});
      // And tell the owner. This path never reaches finalizeRunAccounting, so
      // the Telegram alert that fires for every other terminal run does not
      // fire here — the run that died hardest was the only one going unsaid.
      //
      // watchWillReport:false because evaluateWatchForRun never ran either. Its
      // failure streak has not advanced, so the watch's own "this is broken"
      // message will not come; excluding watch runs here would be silence from
      // both directions, and the only symptom is a watch that stops speaking.
      void (async () => {
        const [run, skill] = await Promise.all([
          getRun(job.runId),
          getSkill(job.skillId),
        ]);
        if (run) {
          await alertRunFinished(run, skill?.name ?? "your skill", Date.now(), {
            watchWillReport: false,
          });
        }
      })().catch((err) => logError("worker.alert", err, { run: job.runId }));
    }
  }
}

let ticking = false;
let lastPruneAt = 0;
const PRUNE_EVERY_MS = 3_600_000; // hourly housekeeping

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    await recoverStuckJobs(Date.now(), STALE_MS);
    // Periodic housekeeping: bound the idempotency + finished-jobs tables.
    if (Date.now() - lastPruneAt > PRUNE_EVERY_MS) {
      lastPruneAt = Date.now();
      void pruneIdempotencyKeys().catch((e) => logError("worker.prune.idem", e));
      void pruneTerminalJobs().catch((e) => logError("worker.prune.jobs", e));
    }
    let n = 0;
    const cap = runSlots.free; // don't claim past free slots (no forced minimum)
    while (n < cap) {
      const job = await claimNextJob();
      if (!job) break;
      n++;
      // Fire-and-forget (browser concurrency bounded by the semaphore), but
      // catch here: processJob's pre-try lines (getSkill/failJob) can reject
      // outside its own try, and an unhandled rejection could take down the
      // worker. A stranded 'running' job is still recovered via STALE_MS.
      void processJob(job).catch((e) => logError("worker.processJob", e));
    }
  } catch (e) {
    logError("worker.tick", e);
  } finally {
    ticking = false;
  }
}

declare global {
  var __aemWorker: ReturnType<typeof setInterval> | undefined;
}

/** Start the job worker (idempotent; HMR-safe via globalThis). */
export function startJobWorker(): void {
  if (globalThis.__aemWorker) return;
  // tick() guards its own body, but the catch is kept here too: a reject from
  // anything added ahead of that try later would otherwise end the process.
  globalThis.__aemWorker = setInterval(() => {
    tick().catch((e) => logError("worker.tick", e));
  }, TICK_MS);
  // Recover anything stranded by a previous process immediately on boot.
  void recoverStuckJobs(Date.now(), STALE_MS)
    .then((n) => {
      if (n) logInfo("worker.recover", `requeued ${n} stale job(s) on boot`);
    })
    .catch((e) => logError("worker.recover", e));
  logInfo("worker.start", "job worker started");
}
