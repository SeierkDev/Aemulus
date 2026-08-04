import { chatsForOwner, mdEscape, sendMessage, telegramEnabled } from "./telegram";
import { publicBaseUrl } from "./public-url";
import {
  logSink,
  type BrokenAlert,
  type StalledAlert,
  type WatchAlert,
  type WatchSink,
} from "./watch-runner";

/**
 * Delivering a watch alert to Telegram.
 *
 * Everything the user actually reads is written here, which makes this the file
 * where the feature is judged. An alert has one job: say what changed, in a
 * glance, from a phone lock screen.
 */

/** Keep a value readable in a notification without letting a page fill the screen. */
function clip(s: string, max = 120): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function runUrl(runId: string): string {
  return `${publicBaseUrl()}/runs/${runId}`;
}

/**
 * Who gets this alert.
 *
 * The watch's own notify target wins when it has one. Otherwise it falls back to
 * every chat the owner has linked — so a watch created before the person linked
 * Telegram starts working the moment they do, rather than silently going
 * nowhere forever.
 */
async function targets(a: { owner: string; notify: WatchAlert["notify"] }): Promise<string[]> {
  if (a.notify?.channel === "telegram" && a.notify.chatId) return [a.notify.chatId];
  return chatsForOwner(a.owner);
}

export const telegramSink: WatchSink = {
  async changed(a: WatchAlert) {
    const chats = await targets(a);
    if (chats.length === 0) return;

    // Redacted mode: say that it changed, never what it changed to. Values from
    // a logged-in page leave this system and enter Telegram's, and for a bank
    // balance or a revenue figure that should be the user's call, not ours. The
    // value is still one tap away behind the receipt.
    const redact = a.notify?.redact === true;
    const body = redact
      ? `*${mdEscape(a.key)}* is different from last time. Open the run to see what it says now.`
      : [
          // Escaped, all of it: the key comes from a recorded skill and the
          // values come off a live web page, so both can contain the characters
          // Telegram treats as formatting. An unbalanced * or _ makes the whole
          // send fail with a 400, which turns into an alert that silently never
          // arrives — the one failure this feature cannot afford.
          `*${mdEscape(a.key)}*`,
          "",
          a.from === null
            ? `Now: ${mdEscape(clip(a.to))}`
            : `Was: ${mdEscape(clip(a.from))}\nNow: ${mdEscape(clip(a.to))}`,
        ].join("\n");

    const text = [
      "*Something changed*",
      "",
      body,
      "",
      "Tap below to see the page I saw when I checked.",
      `\`${a.runId}\``,
    ].join("\n");
    for (const chat of chats) {
      await sendMessage(chat, text, {
        markdown: true,
        // Actionable where the attention already is. Muting a noisy watch used
        // to mean leaving the message, running /watches, reading a number and
        // typing /pause 3 — at whatever hour the alert arrived.
        inlineKeyboard: [
          [
            { text: "Pause", data: `a|p|${a.scheduleId}` },
            { text: "Check again", data: `a|c|${a.scheduleId}` },
          ],
          [{ text: "See what I saw", url: runUrl(a.runId) }],
        ],
      });
    }
  },

  async broken(a: BrokenAlert) {
    const chats = await targets(a);
    if (chats.length === 0) return;
    // Said once — evaluateFailure only reports at the threshold, never again —
    // because a watch that nags about being broken gets muted, and then the
    // alerts that matter are muted too.
    const text = [
      "*A watch stopped working*",
      "",
      "This one has failed several times in a row, so I've stopped alerting on it until it works again. I'll keep trying, and you'll hear from me the moment it succeeds.",
      "",
      "Usually this means the page changed, or the login expired.",
      "",
      a.note,
    ].join("\n");
    for (const chat of chats) {
      await sendMessage(chat, text, {
        markdown: true,
        buttons: [{ text: "Open the run", url: runUrl(a.runId) }],
      });
    }
  },

  async stalled(a: StalledAlert) {
    await logSink.stalled(a);
    const chats = await targets(a);
    if (chats.length === 0) return;
    const text =
      a.reason === "quota"
        ? [
            "*A watch is waiting on your quota*",
            "",
            `I couldn't check *${mdEscape(a.skillName)}* because you've used all your runs for today.`,
            "",
            "It starts again by itself when your quota resets. Send /quota to see where you are, or /pause it if you'd rather it stopped asking.",
          ].join("\n")
        : [
            "*A watch stopped*",
            "",
            `I've switched off *${mdEscape(a.skillName)}* because your wallet no longer holds enough $AEMU to run schedules.`,
            "",
            "Nothing is lost. Top back up and send /watches, then /resume it.",
          ].join("\n");
    for (const chat of chats) {
      await sendMessage(chat, text, { markdown: true });
    }
  },
};

/**
 * The sink the runner should use. Falls back to logging when Telegram is not
 * configured, so the watch path behaves identically in development and in tests
 * — and so a missing token degrades to "no alerts" rather than to an exception
 * inside run settlement.
 */
export function activeSink(): WatchSink {
  return telegramEnabled() ? telegramSink : logSink;
}
