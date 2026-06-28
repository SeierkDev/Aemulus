import {
  bumpNextRun,
  cadenceMs,
  deactivate,
  dueSchedules,
  markRan,
} from "./schedules";
import { getSkill } from "./skills";
import { getQuota } from "./quota";
import { startRun } from "./run-service";
import { logError, logInfo } from "./log";
import type { Session } from "./siws";

/**
 * Autonomous run scheduler. Every minute it finds due schedules and runs them
 * with no human in the loop — the "self-running" half of the economy. Started
 * once at server boot via instrumentation.ts; cached on globalThis so HMR
 * doesn't spawn duplicate tickers.
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
    const next = Date.now() + cadenceMs(s.cadence);
    try {
      const skill = await getSkill(s.skillId);
      // Skill gone or no longer runnable by this owner → stop the schedule.
      if (!skill || (skill.owner !== s.owner && !skill.published)) {
        await deactivate(s.id);
        continue;
      }
      const session: Session = {
        pubkey: s.owner,
        tier: s.tier as Session["tier"],
        level: s.level,
        balance: 0,
      };
      const quota = await getQuota(session);
      if (!quota.ok) {
        await bumpNextRun(s.id, next); // skip this firing, try next cadence
        logInfo("scheduler.skip", "quota exhausted", { schedule: s.id });
        continue;
      }
      const run = await startRun({ skill, input: s.input, runner: s.owner });
      await markRan(s.id, run.id, next);
      logInfo("scheduler.ran", "ok", {
        schedule: s.id,
        run: run.id,
        status: run.status,
      });
    } catch (e) {
      logError("scheduler.run", e, { schedule: s.id });
      await bumpNextRun(s.id, next).catch(() => {});
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
