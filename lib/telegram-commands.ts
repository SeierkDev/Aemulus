import { getSkill, listSkills } from "./skills";
import {
  countActiveSchedules,
  countAllSchedules,
  MAX_ACTIVE_SCHEDULES,
  MAX_TOTAL_SCHEDULES,
  createSchedule,
  deleteSchedule,
  listSchedules,
  setScheduleActive,
  setWatch,
  getWatch,
  cadenceLabel,
} from "./schedules";
import { verifyReceipt } from "./receipt";
import { getQuota } from "./quota";
import { computeTier, getAemulusBalance } from "./solana";
import { publicBaseUrl } from "./public-url";
import { mdEscape, ownerForChat } from "./telegram";
import type { Cadence, Skill } from "./types";

/**
 * What the bot can do once a chat is linked.
 *
 * Everything here returns a Reply rather than sending it, so the whole command
 * surface can be tested without a bot token or a network — the webhook is the
 * only thing that talks to Telegram.
 */

export type Button = { text: string; data: string };
export type Reply = {
  text: string;
  markdown?: boolean;
  /** Inline keyboard rows, for the wizard. */
  keyboard?: Button[][];
};

const SITE = () => publicBaseUrl();

/** Cadences offered in the wizard, in the order a person thinks about them. */
const CADENCES: { c: Cadence; label: string; perDay: number }[] = [
  { c: "hourly", label: "Every hour", perDay: 24 },
  { c: "every6h", label: "Every 6 hours", perDay: 4 },
  { c: "every12h", label: "Every 12 hours", perDay: 2 },
  { c: "daily", label: "Every day", perDay: 1 },
  { c: "weekdays", label: "Weekdays", perDay: 1 },
  { c: "weekly", label: "Every week", perDay: 1 },
];

/** The fields a skill actually captures — the only things a watch can watch. */
export function watchableFields(skill: Skill): string[] {
  const keys = skill.plan
    .filter((s) => s.action === "extract")
    .map((s) => s.outputKey || `value_${s.idx}`);
  return [...new Set(keys)];
}

export const NOT_LINKED: Reply = {
  text: [
    "This chat isn't connected to a wallet yet, so I don't know whose watches to show you.",
    "",
    "Send /start and I'll walk you through it. It takes about a minute.",
  ].join("\n"),
};

/* ── commands ────────────────────────────────────────────────────────────── */

export async function cmdQuota(owner: string): Promise<Reply> {
  // A Telegram chat has no browser session, so the tier is derived from the
  // wallet's balance the same way sign-in does — the bot must not be a way to
  // get a better tier than the site would give you.
  const tier = computeTier(await getAemulusBalance(owner));
  const q = await getQuota({ pubkey: owner, level: tier.level, tier: tier.name } as never);
  const line = q.unlimited
    ? `You have run ${q.used} today. Your tier has no daily limit.`
    : `You have run ${q.used} of ${q.limit} today. ${q.remaining} left, and it resets at midnight UTC.`;
  return {
    text: [
      "*Your usage*",
      "",
      `Tier: *${tier.name}*`,
      line,
      "",
      "Every check a watch makes counts as one run.",
    ].join("\n"),
    markdown: true,
  };
}

export async function cmdVerify(arg: string): Promise<Reply> {
  const runId = arg.trim();
  if (!runId) {
    return {
      text: [
        "Send me a run id and I'll check whether that run really happened the way it claims.",
        "",
        "Like this: `/verify run_a1b2c3`",
        "",
        "You'll find the id on any run page, and it works for anyone's run, not just yours.",
      ].join("\n"),
      markdown: true,
    };
  }
  const v = await verifyReceipt(runId);
  if (!v.found) {
    return {
      text: "I have no receipt for that run. Check the id, or the run may be too old.",
    };
  }
  return {
    text: [
      v.matches
        ? "*Receipt verified*"
        : v.missingShots
          ? "*Can't be checked*"
          : "*Receipt does NOT match*",
      "",
      v.matches
        ? "Everything this run recorded still hashes to the receipt it was given, so nothing has been changed since it ran."
        : v.missingShots
          ? "Some of this run's screenshots are no longer stored, so there is nothing left to check the receipt against. That is missing evidence, not proof of tampering."
          : "What is stored no longer hashes to the recorded receipt, which means something changed after the run finished.",
      "",
      `Status: ${v.status}`,
      `Steps: ${v.steps}`,
      `Hash: \`${v.hash?.slice(0, 24)}…\``,
      "",
      `See the full check here:`,
      `${SITE()}/verify/${runId}`,
    ].join("\n"),
    markdown: true,
  };
}

/** Watches, numbered, so the manage commands can take a number rather than an id. */
export async function cmdWatches(owner: string): Promise<Reply> {
  const all = await listSchedules(owner);
  const watches = [];
  for (const s of all) {
    const w = await getWatch(s.id);
    if (w) watches.push({ s, w });
  }
  if (watches.length === 0) {
    return {
      text: [
        "You aren't watching anything yet.",
        "",
        "Send /watch and I'll set one up. You pick a skill you recorded, the value on the page you care about, and how often I should look.",
      ].join("\n"),
    };
  }
  const lines = watches.map(({ s, w }, i) => {
    const value =
      w.state.lastValue === null
        ? "I haven't checked it yet."
        : `Right now it says: ${mdEscape(clip(w.state.lastValue))}`;
    return [
      `*${i + 1}.  ${mdEscape(s.skillName)}*${s.active ? "" : "   (paused)"}`,
      `Watching *${mdEscape(w.rule.key)}*, checked ${cadenceLabel(s.cadence).toLowerCase()}.`,
      value,
    ].join("\n");
  });
  return {
    text: [
      "*Your watches*",
      "",
      lines.join("\n\n"),
      "",
      "Use the number in front of each one to manage it:",
      "`/pause 1` to stop checking, `/resume 1` to start again, `/delete 1` to remove it.",
    ].join("\n"),
    markdown: true,
  };
}

/** Resolve "the 2nd watch" to a schedule id, the way the user just saw it listed. */
async function watchAt(owner: string, n: number): Promise<{ id: string; name: string } | null> {
  const all = await listSchedules(owner);
  const watches = [];
  for (const s of all) {
    if (await getWatch(s.id)) watches.push(s);
  }
  const s = watches[n - 1];
  return s ? { id: s.id, name: s.skillName } : null;
}

export async function cmdPause(owner: string, arg: string, active: boolean): Promise<Reply> {
  const n = Number(arg.trim());
  if (!Number.isInteger(n) || n < 1) {
    return {
      text: [
        `Tell me which one. Send /watches to see them numbered, then \`${active ? "/resume" : "/pause"} 1\` for the first.`,
      ].join("\n"),
      markdown: true,
    };
  }
  const w = await watchAt(owner, n);
  if (!w) {
    return { text: "You don't have a watch with that number. Send /watches to see the list again." };
  }
  await setScheduleActive(w.id, owner, active);
  return {
    text: active
      ? `Resumed "${w.name}". I'll start checking it again and message you when it changes.`
      : `Paused "${w.name}". I'll stop checking it, and it keeps everything it has learned so far. Send /resume ${n} whenever you want it back.`,
  };
}

export async function cmdDelete(owner: string, arg: string): Promise<Reply> {
  const n = Number(arg.trim());
  if (!Number.isInteger(n) || n < 1) {
    return {
      text: "Tell me which one. Send /watches to see them numbered, then `/delete 1` for the first.",
      markdown: true,
    };
  }
  const w = await watchAt(owner, n);
  if (!w) {
    return { text: "You don't have a watch with that number. Send /watches to see the list again." };
  }
  await deleteSchedule(w.id, owner);
  return { text: `Deleted "${w.name}". I won't check that page again.` };
}

/* ── the /watch wizard ───────────────────────────────────────────────────── */

/**
 * Three taps: skill, field, how often.
 *
 * State rides in the callback data rather than a table, because the whole
 * choice fits: "w|c|skl_a1b2c3d4e5f6|status|daily" is well under Telegram's
 * 64-byte limit. Anything that would not fit is rejected up front rather than
 * silently truncated into a callback that resolves to the wrong skill.
 */
const MAX_CB = 60;

export async function cmdWatch(owner: string): Promise<Reply> {
  const skills = await listSkills(owner);
  const usable = skills.filter((s) => watchableFields(s).length > 0);
  if (usable.length === 0) {
    return {
      text: [
        "To watch a page I need a skill that reads a value off it, and you don't have one yet.",
        "",
        "Record a skill that picks something up from the page: an order status, a price, a stock count, a balance. Then come back here and send /watch again.",
        "",
        `${SITE()}/skills`,
      ].join("\n"),
    };
  }
  return {
    text: [
      "*Step 1 of 3*",
      "",
      "Which skill should I run? I'll use it to open the page and read the value, the same way you recorded it.",
    ].join("\n"),
    markdown: true,
    keyboard: usable.slice(0, 12).map((s) => [{ text: s.name, data: `w|s|${s.id}` }]),
  };
}

/** A button press. Returns null when the data isn't ours. */
export async function handleCallback(
  chatId: string,
  data: string,
): Promise<Reply | null> {
  if (!data.startsWith("w|")) return null;
  const owner = await ownerForChat(chatId);
  if (!owner) return NOT_LINKED;
  const [, kind, skillId, key, cadence] = data.split("|");

  const skill = skillId ? await getSkill(skillId) : null;
  // The skill has to still exist AND still belong to the person tapping —
  // callback data is client-supplied and a stale button must not become a way
  // to watch somebody else's skill.
  if (!skill || skill.owner !== owner) {
    return { text: "That skill no longer exists. Send /watch to start again." };
  }

  if (kind === "s") {
    const fields = watchableFields(skill);
    const rows = fields
      .map((f) => ({ text: f, data: `w|f|${skill.id}|${f}` }))
      .filter((b) => b.data.length <= MAX_CB)
      .map((b) => [b]);
    if (rows.length === 0) {
      return {
        text: "That skill doesn't read any value off the page, so there is nothing for me to watch. Pick another, or record one that captures a value.",
      };
    }
    return {
      text: [
        "*Step 2 of 3*",
        "",
        `Using *${mdEscape(skill.name)}*.`,
        "",
        "Which value should I keep an eye on? I'll message you whenever this one is different from last time.",
      ].join("\n"),
      markdown: true,
      keyboard: rows,
    };
  }

  if (kind === "f") {
    const rows = CADENCES.map((c) => ({
      text: c.label,
      data: `w|c|${skill.id}|${key}|${c.c}`,
    }))
      .filter((b) => b.data.length <= MAX_CB)
      .map((b) => [b]);
    return {
      text: [
        "*Step 3 of 3*",
        "",
        `Watching *${mdEscape(key)}*.`,
        "",
        "How often should I check? Each check uses one run from your daily quota, so pick the slowest one that still tells you in time.",
      ].join("\n"),
      markdown: true,
      keyboard: rows,
    };
  }

  if (kind === "c") {
    const cad = CADENCES.find((c) => c.c === cadence);
    if (!cad) return { text: "I didn't recognise that option. Send /watch to start again." };

    // The same caps the website enforces. A watch IS a schedule, so creating one
    // from here without checking would have made the bot a way around limits
    // that exist to bound scheduler load and row growth. Checked at the last
    // step rather than the first, because this is the only point that actually
    // creates anything.
    if ((await countActiveSchedules(owner)) >= MAX_ACTIVE_SCHEDULES) {
      return {
        text: [
          `You already have ${MAX_ACTIVE_SCHEDULES} watches running, which is the limit.`,
          "",
          "Send /watches to see them, then /pause a number you don't need right now, or /delete it for good.",
        ].join("\n"),
      };
    }
    if ((await countAllSchedules(owner)) >= MAX_TOTAL_SCHEDULES) {
      return {
        text: [
          `You have ${MAX_TOTAL_SCHEDULES} watches saved, which is the limit.`,
          "",
          "Pausing doesn't free a slot here, so send /watches and /delete one you no longer want.",
        ].join("\n"),
      };
    }
    const tier = computeTier(await getAemulusBalance(owner));
    const scheduleId = await createSchedule({
      owner,
      skillId: skill.id,
      input: {},
      cadence: cad.c,
      level: tier.level,
      tier: tier.name,
    });
    await setWatch(
      scheduleId,
      owner,
      { key, op: "changed" },
      { channel: "telegram", chatId },
    );
    return {
      text: [
        "*Watch created*",
        "",
        `I'll run *${mdEscape(skill.name)}* ${cad.label.toLowerCase()} and look at *${mdEscape(key)}*.`,
        `That's about ${cad.perDay} ${cad.perDay === 1 ? "run" : "runs"} a day out of your quota.`,
        "",
        "You'll hear from me only when that value is different from the time before. The very first check has nothing to compare against, so it just records what's there now and stays quiet.",
        "",
        "Send /watches any time to see it.",
      ].join("\n"),
      markdown: true,
    };
  }
  return null;
}

function clip(s: string, max = 40): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
