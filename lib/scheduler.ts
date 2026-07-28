import {
  nextRunAfter,
  claimSchedule,
  deactivate,
  dueSchedules,
  recordRun,
} from "./schedules";
import { getSkill } from "./skills";
import { getQuota } from "./quota";
import { startRun } from "./run-service";
import { computeTier, gatingEnabled, readAemulusBalance } from "./solana";
import { logError, logInfo } from "./log";
import type { Session } from "./siws";

/**
 * Autonomous run scheduler. Every minute it finds due schedules and runs them
 * with no human in the loop - the "self-running" half of the economy. Started
 * once at server boot via instrumentation.ts; cached on globalThis so HMR
 * doesn't spawn duplicate tickers.
 *
 * Durable: schedule state (next_run_at) lives in the DB, so after downtime the
 * first tick fires each schedule that came due once, then resumes one cadence
 * from now (no backfill of every missed interval - that would be a thundering
 * herd). Each firing is claimed atomically (claimSchedule), so overlapping
 * ticks or a second instance can't double-run it. Tiers are refreshed from the
 * live balance at run time rather than trusting the snapshot stored at creation.
 */
async function runDue(): Promise<void> {
  const now = Date.now();
  let due;
  try {
    due = await dueSchedules(now);
  } catch (e) {
    logError("scheduler.due", e);
    return;
  }

  for (const s of due) {
    try {
      // Anchor the next run to the SCHEDULED time, not the processing moment, so
      // per-tick latency doesn't accumulate into forward drift. Roll forward past
      // any backlog (downtime) to the next future slot in one step - no drift and
      // no replay storm.
      let next = nextRunAfter(s.cadence, s.nextRunAt);
      while (next <= now) next = nextRunAfter(s.cadence, next);
      // Reserve this firing before doing anything - losers (other ticks /
      // instances) skip it. A claimed run that then fails just waits a cadence.
      if (!(await claimSchedule(s.id, now, next))) continue;
      const skill = await getSkill(s.skillId);
      // Skill gone or no longer runnable by this owner → stop the schedule.
      if (!skill || (skill.owner !== s.owner && !skill.published)) {
        await deactivate(s.id);
        continue;
      }
      // Refresh tier from the current balance when gating is live; the
      // snapshot stored at creation can be stale.
      let level = s.level;
      let tier = s.tier;
      if (gatingEnabled()) {
        const bal = await readAemulusBalance(s.owner);
        if (bal === null) {
          // Transient RPC failure — do NOT deactivate a legitimate schedule on an
          // unresolved read (a Whale whose balance blips once would otherwise lose
          // their automation forever). Skip this tick; the claim already advanced
          // next_run_at, so it retries next cadence.
          logInfo("scheduler.skip", "balance read failed; retrying next cadence", { schedule: s.id });
          continue;
        }
        const t = computeTier(bal);
        level = t.level;
        tier = t.name;
        if (!t.allowed) {
          await deactivate(s.id); // CONFIRMED no longer holds enough - stop it
          logInfo("scheduler.skip", "no longer eligible", { schedule: s.id });
          continue;
        }
      }
      const session: Session = {
        pubkey: s.owner,
        tier: tier as Session["tier"],
        level,
        balance: 0,
      };
      const quota = await getQuota(session);
      if (!quota.ok) {
        logInfo("scheduler.skip", "quota exhausted", { schedule: s.id });
        continue; // already advanced by the claim
      }
      const run = await startRun({ skill, input: s.input, runner: s.owner });
      await recordRun(s.id, run.id);
      logInfo("scheduler.ran", "ok", {
        schedule: s.id,
        run: run.id,
        status: run.status,
      });
    } catch (e) {
      logError("scheduler.run", e, { schedule: s.id }); // already advanced
    }
  }
}

declare global {
  var __aemScheduler: ReturnType<typeof setInterval> | undefined;
}

export function startScheduler(): void {
  if (globalThis.__aemScheduler) return;
  const tickMs = Math.max(1000, Number(process.env.AEMULUS_SCHEDULER_MS) || 60_000);
  globalThis.__aemScheduler = setInterval(() => void runDue(), tickMs);
  logInfo("scheduler", `started (${tickMs}ms tick)`);
}
