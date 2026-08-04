import { chatsDueDigest, markDigestSent, sendMessage, mdEscape, telegramEnabled } from "./telegram";
import { getClaimable } from "./earnings";
import { listSkills } from "./skills";
import { skillTotals } from "./analytics";
import { logError } from "./log";

/**
 * A wallet's own numbers, once a day, to whoever linked the chat.
 *
 * Everything else in the alerts work serves people watching pages. This serves
 * the people publishing skills, and they are the side the marketplace actually
 * depends on. It needs no page to watch, no skill to record and no quota: the
 * earnings ledger and per-skill analytics already hold all of it.
 *
 * Sent only when there is something to say. A daily message reporting that
 * nothing happened is how a bot gets muted, and a muted bot takes the alerts
 * that matter with it.
 */

const EVERY_MS = 22 * 60 * 60 * 1000;

/**
 * Guards against overlapping sweeps. buildDigest reads a week of runs per
 * skill, so a sweep can outlast the scheduler tick that started it — and the
 * "already sent" mark only lands after that work, so a second sweep would pick
 * up the same chats and send the digest twice.
 */
let sweeping = false;

/** How far a rate has to move before it is worth interrupting someone. */
const RATE_DROP_PT = 0.05;

/** Published skills reported per digest. Beyond this the message stops being
 *  readable, so the count of what was left out is shown rather than dropped. */
const MAX_LINES = 6;

export interface DigestLine {
  skill: string;
  runs: number;
  rate: number | null;
}

export async function buildDigest(owner: string): Promise<{
  lines: DigestLine[];
  claimable: number;
  others: number;
  worthSending: boolean;
} | null> {
  const skills = await listSkills(owner);
  const published = skills.filter((s) => s.published);
  const active: DigestLine[] = [];

  for (const s of published) {
    const t = await skillTotals(s.id, 7);
    if (t.runs === 0) continue; // nothing happened; say nothing about it
    active.push({ skill: s.name, runs: t.runs, rate: t.rate });
  }

  // Busiest first, so the cut falls on the skills that matter least — and the
  // remainder is counted rather than quietly dropped.
  active.sort((a, b) => b.runs - a.runs);
  const lines = active.slice(0, MAX_LINES);
  const others = active.length - lines.length;

  const claimable = await getClaimable(owner);

  // Worth an interruption when somebody used a skill, or there is money to
  // collect, or a rate slipped far enough to be worth looking at.
  const slipped = lines.some((l) => l.rate !== null && l.rate < 1 - RATE_DROP_PT);
  const worthSending = lines.length > 0 || claimable > 0 || slipped;
  return { lines, claimable, others, worthSending };
}

export function renderDigest(d: {
  lines: DigestLine[];
  claimable: number;
  others?: number;
}): string {
  const out = ["*Your skills this week*", ""];
  if (d.lines.length === 0) {
    out.push("Nobody ran a published skill this week.");
  } else {
    for (const l of d.lines) {
      const rate = l.rate === null ? "—" : `${(l.rate * 100).toFixed(1)}%`;
      out.push(`*${mdEscape(l.skill)}*`);
      out.push(`${l.runs} ${l.runs === 1 ? "run" : "runs"} · ${rate} succeeded`);
      // The number that actually needs acting on. A rate falling usually means
      // the page changed, and the author is the only one who can fix it.
      if (l.rate !== null && l.rate < 1 - RATE_DROP_PT) {
        out.push("That rate is slipping. The page it runs on may have changed.");
      }
      out.push("");
    }
  }
  if (d.others && d.others > 0) {
    out.push(`and ${d.others} more that ran this week.`);
    out.push("");
  }
  if (d.claimable > 0) {
    out.push(`${Math.round(d.claimable).toLocaleString()} $AEMU claimable.`);
  }
  return out.join("\n").trim();
}

/**
 * Send to every chat that is due one. Never throws: this runs on the scheduler
 * tick, and a digest failing must not stop schedules firing.
 */
export async function sweepDigests(): Promise<number> {
  if (!telegramEnabled() || sweeping) return 0;
  sweeping = true;
  let sent = 0;
  try {
    const due = await chatsDueDigest(EVERY_MS);
    for (const { chatId, owner } of due) {
      try {
        const d = await buildDigest(owner);
        // Marked either way. A wallet with nothing to report should not be
        // recomputed on every tick for the rest of the day.
        await markDigestSent(chatId);
        if (!d?.worthSending) continue;
        await sendMessage(chatId, renderDigest(d), { markdown: true });
        sent++;
      } catch (e) {
        logError("digest.one", e, { chat: chatId });
      }
    }
  } catch (e) {
    logError("digest.sweep", e);
  } finally {
    sweeping = false;
  }
  return sent;
}
