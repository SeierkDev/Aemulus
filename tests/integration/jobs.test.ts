import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  enqueueRunJob,
  claimNextJob,
  completeJob,
  failJob,
  recoverStuckJobs,
} from "../../lib/jobs";
import { startRun } from "../../lib/run-service";
import { createSkill } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "J", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("job queue", () => {
  it("enqueues, claims atomically (once), and decrypts the payload", async () => {
    await enqueueRunJob({
      runId: "run_j1",
      runner: "W",
      skillId: "skl_j",
      input: { vendor: "Acme" },
      overrides: { "1": { skip: true } },
    });
    const job = await claimNextJob();
    expect(job!.runId).toBe("run_j1");
    expect(job!.input).toEqual({ vendor: "Acme" }); // round-trips through encryption
    expect(job!.overrides).toEqual({ "1": { skip: true } });
    expect(job!.attempts).toBe(1);
    // it's now 'running' — a second claim must not hand out the same job
    expect(await claimNextJob()).toBeNull();
    await completeJob(job!.id); // settle so later tests start clean
  });

  it("retries with backoff, then fails permanently after maxAttempts", async () => {
    await enqueueRunJob({ runId: "run_j2", runner: "W", skillId: "skl_j", input: {} });
    const base = Date.now();
    let job = await claimNextJob(base + 5);
    expect(job!.runId).toBe("run_j2");
    expect(await failJob(job!.id, "boom", 3)).toBe(true); // re-queued with backoff
    // backoff puts run_at ~1s out — not claimable yet
    expect(await claimNextJob(base + 5)).toBeNull();
    // attempt 2 (past the 1s backoff)
    job = await claimNextJob(Date.now() + 5_000);
    expect(job!.runId).toBe("run_j2");
    expect(job!.attempts).toBe(2);
    expect(await failJob(job!.id, "boom", 3)).toBe(true);
    // attempt 3 → permanent failure
    job = await claimNextJob(Date.now() + 10_000);
    expect(job!.attempts).toBe(3);
    expect(await failJob(job!.id, "boom", 3)).toBe(false);
    expect(await claimNextJob(Date.now() + 999_999)).toBeNull();
  });

  it("recovers jobs whose worker died mid-run", async () => {
    await enqueueRunJob({ runId: "run_j3", runner: "W", skillId: "skl_j", input: {} });
    const t = Date.now();
    const claimed = await claimNextJob(t + 5); // running, locked_at ≈ t+5
    expect(claimed!.runId).toBe("run_j3");
    // not stale yet
    expect(await recoverStuckJobs(t + 10, 60_000)).toBe(0);
    // stale → requeued
    expect(await recoverStuckJobs(Date.now() + 100, 50)).toBeGreaterThanOrEqual(1);
    const reclaimed = await claimNextJob(Date.now() + 200);
    expect(reclaimed!.runId).toBe("run_j3");
    expect(reclaimed!.attempts).toBe(2); // a second attempt
    await completeJob(reclaimed!.id);
  });

  it("failJob with a STALE locked_at doesn't settle a job a new owner re-claimed", async () => {
    await enqueueRunJob({ runId: "run_j_fence", runner: "W", skillId: "skl_j", input: {} });
    const t = Date.now();
    const first = await claimNextJob(t + 5); // locked_at = t+5, attempts 1
    expect(first!.runId).toBe("run_j_fence");
    const staleLock = first!.lockedAt;
    // The job goes stale and a NEW owner re-claims it (locked_at advances).
    await recoverStuckJobs(t + 10_000, 50);
    const second = await claimNextJob(t + 20_000); // new locked_at, attempts 2
    expect(second!.runId).toBe("run_j_fence");
    expect(second!.lockedAt).not.toBe(staleLock);
    // The superseded first worker now fails out. With maxAttempts=1 it hits the
    // permanent-fail branch, but the stale fence must make the UPDATE a no-op AND
    // report "retried" (true) — so the caller does NOT settle the run the new owner
    // is actively executing.
    expect(await failJob(first!.id, "stale", 1, staleLock)).toBe(true);
    // The job is still 'running' under the new owner (not flipped to 'failed'): a
    // fresh claim finds nothing, and completing the real owner's claim settles it.
    expect(await claimNextJob(t + 30_000)).toBeNull();
    await completeJob(second!.id, second!.lockedAt);
  });

  it("startRun enqueues a job (durable, not in-request)", async () => {
    const skill = await createSkill({ owner: "JOB_OWNER", generalized: GEN, sourceDemoId: null });
    const run = await startRun({ skill, input: { x: "1" }, runner: "JOB_OWNER" });
    expect(run.status).toBe("running");
    const job = await claimNextJob();
    expect(job!.runId).toBe(run.id);
    expect(job!.input).toEqual({ x: "1" });
  });
});
