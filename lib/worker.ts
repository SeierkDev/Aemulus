import { getSkill } from "./skills";
import { completeRun } from "./run-service";
import { finishRun } from "./runs";
import { dispatchRunEvent } from "./webhooks";
import {
  claimNextJob,
  completeJob,
  failJob,
  recoverStuckJobs,
  type Job,
} from "./jobs";
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
const STALE_MS = RUN_TIMEOUT_MS + 120_000; // generous: a slot-waiting job isn't "stale"

async function processJob(job: Job): Promise<void> {
  const skill = await getSkill(job.skillId);
  if (!skill) {
    await finishRun(job.runId, {
      status: "failed",
      error: "Skill no longer exists.",
    }).catch(() => {});
    await failJob(job.id, "skill removed", 0); // 0 attempts allowed → permanent
    incr("jobs.failed");
    return;
  }
  try {
    await completeRun(job.runId, {
      skill,
      input: job.input,
      overrides: job.overrides,
      runner: job.runner,
    });
    await completeJob(job.id);
    incr("jobs.done");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "run failed";
    const retried = await failJob(job.id, msg, MAX_ATTEMPTS);
    incr(retried ? "jobs.retried" : "jobs.failed");
    if (!retried) {
      // Out of retries — settle the run as failed and notify.
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
    }
  }
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    await recoverStuckJobs(Date.now(), STALE_MS);
    let n = 0;
    const cap = Math.max(1, runSlots.free);
    while (n < cap) {
      const job = await claimNextJob();
      if (!job) break;
      n++;
      void processJob(job); // browser concurrency bounded by the semaphore
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
  globalThis.__aemWorker = setInterval(() => void tick(), TICK_MS);
  // Recover anything stranded by a previous process immediately on boot.
  void recoverStuckJobs(Date.now(), STALE_MS)
    .then((n) => {
      if (n) logInfo("worker.recover", `requeued ${n} stale job(s) on boot`);
    })
    .catch((e) => logError("worker.recover", e));
  logInfo("worker.start", "job worker started");
}
