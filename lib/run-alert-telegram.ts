import { privateChatsForOwner, sendMessage, mdEscape, telegramEnabled } from "./telegram";
import { publicBaseUrl } from "./public-url";
import { logError } from "./log";
import type { Run } from "./types";

/**
 * Telling you about an ordinary run, not only a watch.
 *
 * A finished or failed run could already reach a signed webhook, which serves a
 * program and nobody else. If you set a skill running on a schedule and it
 * started failing, the product's answer was that you would notice eventually —
 * on the runs page, if you thought to look. A watch has told you in Telegram
 * since the alerts work shipped; an ordinary run had no equivalent.
 *
 * WHAT IT DOES NOT DO is the important half. Notifying on every terminal run
 * would be the fastest way to get the bot muted, and a muted bot takes the watch
 * alerts with it. So:
 *
 *   failed / needs_review  — always. Both need a person, and a run that stops
 *                            for review is waiting on you specifically.
 *   completed              — only when nobody was watching, i.e. the run came
 *                            from a schedule. A run you started yourself
 *                            finishes on a page you are already looking at.
 *
 * Watch runs are excluded outright: they alert through their own rule, and
 * sending both would mean two messages for one event.
 */

/** A failing schedule fires every cadence. One message an hour is plenty. */
const REPEAT_MS = 60 * 60 * 1000;

/**
 * Last time we told this owner about this skill+status.
 *
 * In process, so it resets on deploy — the cost of that is one extra message
 * after a restart, which is the right trade against a table and a write on
 * every settled run.
 */
const lastSent = new Map<string, number>();

function suppressed(key: string, now: number): boolean {
  const prev = lastSent.get(key);
  if (prev !== undefined && now - prev < REPEAT_MS) return true;
  lastSent.set(key, now);
  // Bounded: without this the map grows with every distinct skill forever.
  if (lastSent.size > 5000) {
    for (const [k, t] of lastSent) if (now - t > REPEAT_MS) lastSent.delete(k);
  }
  return false;
}

/**
 * Should this run interrupt anyone?
 *
 * `watchWillReport` is false on the one path where a run dies WITHOUT its watch
 * ever being evaluated — a job that exhausts its retries never reaches
 * finalizeRunAccounting, so evaluateWatchForRun never runs. Excluding watch runs
 * there would mean total silence: the watch's failure streak never advances
 * either, so its own "this watch is broken" message never fires, and the only
 * symptom is a watch that quietly stops saying anything.
 */
export function shouldAlert(
  run: {
    status: string;
    isWatch?: boolean;
    scheduleId?: string | null;
  },
  watchWillReport = true,
): boolean {
  if (run.isWatch && watchWillReport) return false; // its watch rule speaks for it
  if (run.status === "failed" || run.status === "needs_review") return true;
  // A completed run only earns a message when it ran without you.
  return run.status === "completed" && !!run.scheduleId;
}

const HEADING: Record<string, string> = {
  failed: "Run failed",
  needs_review: "Run needs you",
  completed: "Run finished",
};

export function renderRunAlert(
  run: { id: string; status: string; error?: string | null; output?: Record<string, string> | null },
  skillName: string,
): string {
  const lines = [`*${HEADING[run.status] ?? "Run finished"}*`, "", `*${mdEscape(skillName)}*`];

  if (run.status === "failed" && run.error) {
    lines.push("", mdEscape(clip(run.error)));
  } else if (run.status === "needs_review") {
    lines.push("", "It stopped on a step it wasn't sure about, and it's waiting for you.");
  } else if (run.output && Object.keys(run.output).length) {
    /**
     * What it captured, never the values.
     *
     * A watch offers redaction for exactly this: values read off a logged-in
     * page leave this system and enter Telegram's, and for a bank balance or a
     * revenue figure that is the user's call rather than ours. A watch can make
     * it a choice because it has a notify object to hold the setting. An
     * ordinary schedule has none — so there is no way to opt out, and printing
     * them would be deciding on someone's behalf.
     *
     * Extension runs make this concrete rather than theoretical: they execute
     * in the user's own signed-in browser, so a logged-in page is the normal
     * case, not the edge one.
     *
     * The values are one tap away behind the link, where seeing them still
     * requires being signed in.
     */
    const n = Object.keys(run.output).length;
    lines.push("", `Captured ${n} ${n === 1 ? "value" : "values"}.`);
  }
  return lines.join("\n");
}

function clip(s: string, n = 220): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * Best-effort. Never throws: this runs after a run has settled and its receipt
 * is attached, so the worst case here is a missed message.
 */
export async function alertRunFinished(
  run: Run,
  skillName: string,
  now: number = Date.now(),
  opts: { watchWillReport?: boolean } = {},
): Promise<void> {
  try {
    if (!telegramEnabled()) return;
    if (!shouldAlert(run, opts.watchWillReport ?? true)) return;
    if (suppressed(`${run.owner}:${run.skillId}:${run.status}`, now)) return;

    // Private chats only. A watch reaches a room on purpose — that is what
    // /here is for. This is the owner's own account activity, and the digest
    // already made the same call for the same reason.
    const chats = await privateChatsForOwner(run.owner);
    if (chats.length === 0) return;

    const text = renderRunAlert(run, skillName);
    const url = `${publicBaseUrl()}/runs/${run.id}`;
    for (const chat of chats) {
      await sendMessage(chat, text, {
        markdown: true,
        inlineKeyboard: [[{ text: "Open the run", url }]],
      });
    }
  } catch (e) {
    logError("runAlert.telegram", e, { run: run.id });
  }
}

/**
 * A run has stopped and is waiting for a person, right now.
 *
 * The only alert here where the message changes the outcome rather than
 * reporting it. A captcha or an interactive checkpoint parks the run and holds
 * the browser open for LIVE_TIMEOUT_MS; if nobody arrives it gives up. Until
 * now nobody was told, so the owner learned about it from the needs_review
 * message afterwards — accurate, and far too late to have done anything.
 *
 * Keyed on the RUN, not the skill: the hourly collapse that stops a failing
 * schedule shouting every cadence would, here, silence a second run's pause and
 * cost it its window. A run cannot pause twice usefully, so once per run is the
 * right bound.
 */
export async function alertRunPaused(
  run: { id: string; owner: string },
  skillName: string,
  waitMs: number,
  now: number = Date.now(),
): Promise<void> {
  try {
    if (!telegramEnabled()) return;
    if (suppressed(`${run.owner}:${run.id}:paused`, now)) return;

    const chats = await privateChatsForOwner(run.owner);
    if (chats.length === 0) return;

    const mins = Math.max(1, Math.round(waitMs / 60000));
    const text = [
      "*Run paused \u2014 it needs you*",
      "",
      `*${mdEscape(skillName)}*`,
      "",
      `It hit something only a person can clear: a login step, a captcha, a confirmation. The browser is held open and waiting for about ${mins} ${mins === 1 ? "minute" : "minutes"}.`,
    ].join("\n");

    const url = `${publicBaseUrl()}/runs/${run.id}`;
    for (const chat of chats) {
      await sendMessage(chat, text, {
        markdown: true,
        inlineKeyboard: [[{ text: "Take over", url }]],
      });
    }
  } catch (e) {
    logError("runAlert.paused", e, { run: run.id });
  }
}

/**
 * A run that ended before the runner ever saw it.
 *
 * Queueing failed, or the skill was deleted out from under a queued job. These
 * settle the run as failed and return; none of them reaches
 * finalizeRunAccounting, so none produces the message every other terminal run
 * gets — and one of them does not even dispatch a webhook, which makes it
 * silent on every channel there is.
 *
 * The caller usually cannot cover for it either. A chained run is
 * fire-and-forget by design, so the throw has nobody to reach, and a scheduled
 * run's throw reaches the scheduler rather than the person whose schedule just
 * produced nothing.
 *
 * watchWillReport:false throughout, for the same reason as the worker path:
 * evaluateWatchForRun never ran, so the watch will not speak for itself either.
 */
export async function alertRunNeverStarted(
  runId: string,
  skillName: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    const { getRun } = await import("./runs");
    const run = await getRun(runId);
    if (!run) return;
    await alertRunFinished(run, skillName, now, { watchWillReport: false });
  } catch (e) {
    logError("runAlert.neverStarted", e, { run: runId });
  }
}
