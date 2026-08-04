import { getWatch, setWatchState } from "./schedules";
import type { WatchState } from "./watches";
import { evaluate, evaluateFailure, type WatchDecision } from "./watches";
import { logError, logInfo } from "./log";
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
      if (from !== to) {
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
        await sink.broken({ ...base, note: decision.note ?? "This watch is failing." });
      } else {
        await sink.changed({ ...base, from: decision.from ?? null, to: decision.to ?? "" });
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
