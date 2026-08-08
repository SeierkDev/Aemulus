import { getWatch, setWatchState } from "./schedules";
import type { WatchState } from "./watches";
import { evaluate, evaluateFailure, type WatchDecision } from "./watches";
import { logError, logInfo } from "./log";
import { fireWatchAction, shouldAlert } from "./watch-action";
import type { Run, WatchNotify } from "./types";

/**
 * Turning a finished run into an alert, or into silence.
 *
 * This hangs off run COMPLETION rather than the scheduler tick, which is not a
 * style choice: startRun returns as soon as the row exists and the job is
 * queued, so the tick has no output to look at. By the time a run has an
 * extracted value, the scheduler moved on minutes ago.
 */

export type WatchAlert = {
  scheduleId: string;
  owner: string;
  runId: string;
  skillId: string;
  /** The field being watched, e.g. "status". */
  key: string;
  from: string | null;
  to: string;
  notify: WatchNotify | null;
  at: number;
};

export type BrokenAlert = {
  scheduleId: string;
  owner: string;
  runId: string;
  skillId: string;
  key: string;
  note: string;
  notify: WatchNotify | null;
  at: number;
};

/**
 * Where alerts go. Telegram arrives in the next phase; until then this is a log
 * line, which is deliberate — it means the whole watch path can be built and
 * verified before a bot token exists, and phase 3 becomes transport only.
 */
/**
 * The watch could not run at all: no quota left, or the wallet no longer holds
 * enough to schedule anything. Distinct from `broken`, which means it ran and
 * failed. To the person waiting, both look identical from the outside — silence
 * — and silence from a watch is indistinguishable from "nothing changed". That
 * is the one failure an alerting feature cannot afford, so it gets said out
 * loud.
 */
export type StalledAlert = {
  scheduleId: string;
  owner: string;
  skillName: string;
  reason: "quota" | "tier";
  /** True when the watch was switched off rather than skipped for now. */
  stopped: boolean;
  notify: WatchAlert["notify"];
};

export type WatchSink = {
  changed(a: WatchAlert): Promise<void>;
  broken(a: BrokenAlert): Promise<void>;
  stalled(a: StalledAlert): Promise<void>;
};

export const logSink: WatchSink = {
  async changed(a) {
    logInfo("watch.changed", `${a.key}: ${a.from ?? "—"} → ${a.to}`, {
      schedule: a.scheduleId,
      run: a.runId,
    });
  },
  async broken(a) {
    logInfo("watch.broken", a.note, { schedule: a.scheduleId, run: a.runId });
  },
  async stalled(a) {
    logInfo("watch.stalled", a.reason, { schedule: a.scheduleId, stopped: a.stopped });
  },
};

/**
 * Evaluate the watch attached to a finished run, if there is one.
 *
 * Safe to call for every run: returns immediately when the run did not come
 * from a schedule, or the schedule has no watch rule.
 */
export async function evaluateWatchForRun(
  run: Run,
  sink: WatchSink = logSink,
  now: number = Date.now(),
): Promise<WatchDecision | null> {
  if (!run.scheduleId) return null;
  try {
    const watch = await getWatch(run.scheduleId);
    if (!watch) return null;

    const raw = run.output?.[watch.rule.key];

    // A run that did not complete, or that completed without capturing the
    // field, is a FAILED CHECK — never a change. The value going missing
    // because a login lapsed must not be reported as the value becoming empty.
    // See evaluateFailure: the baseline is left untouched and only the failure
    // streak moves.
    const decision =
      run.status !== "completed" || typeof raw !== "string"
        ? evaluateFailure(
            watch.state,
            run.status !== "completed"
              ? `The run ${run.status === "failed" ? "failed" : "did not complete"}.`
              : `The skill did not capture "${watch.rule.key}" this time.`,
          )
        : evaluate(watch.rule, watch.state, raw, now);

    const muted = watch.mutedUntil != null && watch.mutedUntil > now;

    /**
     * Is this the first check this watch has ever completed?
     *
     * "changed" already refuses to fire without a baseline — the comment in
     * watches.ts says alerting then would fire for every new watch. The
     * threshold ops never consult the baseline at all, which is defensible for
     * a MESSAGE ("it is already below 5, you should know") and is not
     * defensible for an ACTION: creating a watch on a page whose condition is
     * already true would immediately run a skill, spend a run, and do something
     * on the owner's behalf before anything had actually happened. So the alert
     * behaviour is left exactly as it was, and only the action waits for a
     * second check. With alsoAlert:false the message comes back anyway, because
     * fired.ran stays false — nothing done and nothing said is the one outcome
     * to avoid.
     */
    const firstCheck = watch.state.lastValue === null;

    // Muting is not pausing: the check still runs and lastValue still moves, so
    // /watches keeps telling the truth about what the page says right now.
    //
    // But silence must not swallow the event. A one-time flip — socials
    // vanishing from a coin page, the earliest rug tell the pack ships — moves
    // the baseline with it, and by the time anyone is listening again nothing
    // differs. The alert the watch existed for is never sent and nothing says
    // so. So the value at the start of the quiet is kept aside, and the first
    // check after the mute compares against THAT: one message for the net
    // change, however many times it moved in between.
    const persist: WatchState = muted
      ? { ...decision.state, mutedFrom: watch.state.mutedFrom ?? watch.state.lastValue ?? null }
      : { ...decision.state, mutedFrom: undefined };

    // Persist on EVERY check, not only when alerting: the confirm counter and
    // the failure streak are exactly the things that have to survive between
    // checks.
    await setWatchState(run.scheduleId, persist);

    // The mute just lifted. decision only knows about the last hop, so it can
    // report nothing while the value is still somewhere new — compare across
    // the whole quiet instead.
    const lifted = !muted && watch.state.mutedFrom !== undefined;
    if (lifted && !decision.broken) {
      const from = watch.state.mutedFrom ?? null;
      const to = decision.state.lastValue ?? "";
      // Judged by the RULE, not by raw difference.
      //
      // This used to alert whenever the two strings differed, which is right
      // for "tell me when it changes" and wrong for every threshold: a watch
      // for "above 100" reported 50 → 60 as its event, purely because a mute
      // had lapsed. Re-running the evaluator against the value from before the
      // quiet asks the actual question — did it CROSS — with one reading in
      // place of the many that were skipped.
      const across =
        run.status === "completed" && typeof raw === "string"
          ? evaluate(
              watch.rule,
              { ...watch.state, lastValue: from, pendingValue: null, pendingCount: 0 },
              raw,
              now,
            )
          : null;
      if (across ? across.notify : from !== to) {
        // And the ACTION fires here too. It did not, so a watch that was muted
        // over the weekend came back, said the thing had happened, and never
        // did the thing — with the new baseline already persisted above, so the
        // next check saw no change and the action for that event was gone for
        // good. With alsoAlert:false it was the exact inverse of what the owner
        // asked for: the message they turned off, and none of the work.
        const fired =
          from === null
            ? ({ ran: false, reason: "no baseline from before the quiet" } as const)
            : await fireWatchAction({
                action: watch.action,
                owner: watch.owner,
                watchedSkillId: run.skillId,
                key: watch.rule.key,
                value: to,
                scheduleId: run.scheduleId,
              });
        if (shouldAlert(watch.action) || !fired.ran) {
          await sink.changed({
            scheduleId: run.scheduleId,
            owner: watch.owner,
            runId: run.id,
            skillId: run.skillId,
            key: watch.rule.key,
            notify: watch.notify,
            at: now,
            from,
            to,
          });
        }
        return decision;
      }
      // Nothing net changed across the quiet, so there is no event to report —
      // and decision, which only saw the last hop, must not invent one.
      return decision;
    }

    if (decision.notify && !muted) {
      const base = {
        scheduleId: run.scheduleId,
        owner: watch.owner,
        runId: run.id,
        skillId: run.skillId,
        key: watch.rule.key,
        notify: watch.notify,
        at: now,
      };
      if (decision.broken) {
        // A failing watch never triggers anything. "The check could not read the
        // value" is the one state where acting on it is exactly wrong.
        await sink.broken({ ...base, note: decision.note ?? "This watch is failing." });
      } else {
        // The action fires on a real change, on the same events and under the
        // same cooldown as the message. It is awaited so the run row exists
        // before the alert names it, and it never throws.
        const fired = firstCheck
          ? ({ ran: false, reason: "first check — no baseline yet" } as const)
          : await fireWatchAction({
          action: watch.action,
          owner: watch.owner,
          watchedSkillId: run.skillId,
          key: watch.rule.key,
          value: decision.to ?? "",
          scheduleId: run.scheduleId,
        });
        if (shouldAlert(watch.action)) {
          await sink.changed({ ...base, from: decision.from ?? null, to: decision.to ?? "" });
        } else if (!fired.ran) {
          // The owner asked for the action INSTEAD of the message. If the action
          // did not happen, silence would be the worst of both — nothing done
          // and nothing said — so the message comes back for that case only.
          await sink.changed({ ...base, from: decision.from ?? null, to: decision.to ?? "" });
        }
      }
    }
    return decision;
  } catch (e) {
    // A watch must never be able to break a run's settlement. The run already
    // completed and its receipt is attached by this point; the worst case here
    // is a missed alert, and the next check picks the watch back up.
    logError("watch.evaluate", e, { run: run.id, schedule: run.scheduleId });
    return null;
  }
}
