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
  setWatchNotify,
  getWatch,
  muteUntil,
  cadenceLabel,
  affordableCadences,
} from "./schedules";
import { verifyReceipt } from "./receipt";
import { getQuota, quotaReserveForWatch } from "./quota";
import { computeTier, getAemulusBalance, watchLimitForLevel } from "./solana";
import { publicBaseUrl } from "./public-url";
import { ALERT_PRESETS } from "./alert-pack";
import { mdEscape, ownerForChat } from "./telegram";
import {
  recordedRule,
  ruleFitsCapture,
  ruleIsUsable,
  ruleSentence,
  type WatchRule,
} from "./watches";
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
  { c: "every10m", label: "Every 10 minutes", perDay: 144 },
  { c: "every15m", label: "Every 15 minutes", perDay: 96 },
  { c: "every30m", label: "Every 30 minutes", perDay: 48 },
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
  // What each action RUNS, not just that it runs something. An action can only
  // be disarmed, never edited, so a line that will not name the skill leaves
  // nothing anywhere that says what you armed.
  const actionNames = new Map<string, string>();
  if (watches.some(({ w }) => w.action?.kind === "run_skill")) {
    for (const sk of await listSkills(owner)) actionNames.set(sk.id, sk.name);
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
    // When it last looked, not just what it saw. Without this, "nothing has
    // changed" and "this hasn't run since Tuesday" read identically.
    const seen = s.lastRunAt ? `Last checked ${ago(s.lastRunAt)}.` : "Not checked yet.";
    const muted =
      w.mutedUntil && w.mutedUntil > Date.now()
        ? `   (muted for ${Math.max(1, Math.round((w.mutedUntil - Date.now()) / 3600000))}h)`
        : "";
    return [
      `*${i + 1}.  ${mdEscape(s.skillName)}*${s.active ? "" : "   (paused)"}${muted}`,
      // The RULE, not just the key. "below 5" and "whenever it changes" are very
      // different watches, and showing only the field made a stricter one look
      // like a broken one — it is quiet either way.
      `Watching: ${mdEscape(ruleSentence(w.rule))}, checked ${cadenceLabel(s.cadence).toLowerCase()}.`,
      // Something that starts a run on your behalf must be visible in the list
      // you manage it from.
      ...(w.action && w.action.kind === "run_skill"
        ? [
            actionNames.has(w.action.skillId)
              ? `Then it runs *${mdEscape(actionNames.get(w.action.skillId)!)}* for you.`
              : "Then it runs a skill you can no longer open.",
          ]
        : []),
      value,
      seen,
    ].join("\n");
  });
  return {
    text: [
      "*Your watches*",
      "",
      lines.join("\n\n"),
      "",
      "Use the number in front of each one to manage it:",
      "`/check 1` to look now, `/mute 1 24h` to go quiet for a while,",
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

export async function cmdCheck(owner: string, arg: string): Promise<Reply> {
  const n = Number(arg.trim());
  if (!Number.isInteger(n) || n < 1) {
    return {
      text: "Tell me which one. Send /watches to see them numbered, then `/check 1` for the first.",
      markdown: true,
    };
  }
  const w = await watchAt(owner, n);
  if (!w) {
    return { text: "You don't have a watch with that number. Send /watches to see the list again." };
  }
  return checkNow(owner, w.id, w.name);
}

/**
 * Snooze rather than pause.
 *
 * Pause reads as permanent and people never come back to undo it, so a watch
 * that was annoying for an afternoon stays off forever. A snooze says when it
 * returns, and it returns by itself.
 */
export async function cmdMute(owner: string, arg: string): Promise<Reply> {
  const [numRaw, durRaw] = arg.trim().split(/\s+/);
  const n = Number(numRaw);
  if (!Number.isInteger(n) || n < 1) {
    return {
      text: "Tell me which one and for how long. Like `/mute 1 24h`, or just `/mute 1` for a day.",
      markdown: true,
    };
  }
  const hours = parseHours(durRaw);
  if (hours === null) {
    return { text: "I didn't understand that length. Try `2h`, `24h` or `3d`.", markdown: true };
  }
  const w = await watchAt(owner, n);
  if (!w) {
    return { text: "You don't have a watch with that number. Send /watches to see the list again." };
  }
  await muteUntil(w.id, owner, Date.now() + hours * 60 * 60 * 1000);
  return {
    text: `Muted "${w.name}" for ${hours === 24 ? "a day" : `${hours}h`}. It starts again by itself, and it keeps checking in the meantime so you won't miss what changed while it was quiet.`,
  };
}

/** "2h", "24h", "3d", or nothing at all meaning a day. Bounded to a week. */
function parseHours(raw: string | undefined): number | null {
  if (!raw) return 24;
  const m = /^(\d+)\s*([hd])$/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const hours = m[2].toLowerCase() === "d" ? n * 24 : n;
  if (hours < 1 || hours > 24 * 7) return null;
  return hours;
}

/**
 * The curated list, in the bot.
 *
 * Someone who finds the bot before the site should never have to leave it to
 * get value. Presets with no recorded skill behind them say so rather than
 * offering a button that quietly does nothing.
 */
export async function cmdAlerts(owner: string): Promise<Reply> {
  const tier = computeTier(await getAemulusBalance(owner));
  const allowance = watchLimitForLevel(tier.level);
  const affordable = new Set(affordableCadences(allowance));

  const ready = ALERT_PRESETS.filter((p) => p.skillId && affordable.has(p.suggested));
  const lines = [
    "*Alerts*",
    "",
    "Pick something to be told about. I check the page and message you here when it changes.",
    "",
  ];
  for (const p of ALERT_PRESETS) {
    const mark = !p.skillId ? "soon" : affordable.has(p.suggested) ? "ready" : "higher tier";
    lines.push(`*${mdEscape(p.title)}* — ${mdEscape(p.detail)}  (${mark})`);
  }
  lines.push("");
  lines.push(
    ready.length > 0
      ? "Tap one below to turn it on."
      : "None of these have a recorded skill behind them yet. Send /watch to build one from a skill you already have.",
  );

  return {
    text: lines.join("\n"),
    markdown: true,
    keyboard: ready.slice(0, 10).map((p) => [{ text: p.title, data: `w|s|${p.skillId}` }]),
  };
}

/**
 * Send a watch's alerts to THIS chat.
 *
 * The plumbing for group delivery already existed — a watch targets one chat id
 * and an owner can link several — but there was no way to move an existing
 * watch, so an alert set up in a DM could never reach a team.
 */
export async function cmdHere(owner: string, arg: string, chatId: string): Promise<Reply> {
  const n = Number(arg.trim());
  if (!Number.isInteger(n) || n < 1) {
    return {
      text: "Tell me which one. Send /watches to see them numbered, then `/here 1` in the chat you want the alerts in.",
      markdown: true,
    };
  }
  const w = await watchAt(owner, n);
  if (!w) {
    return { text: "You don't have a watch with that number. Send /watches to see the list again." };
  }
  const watch = await getWatch(w.id);
  if (!watch) return { text: "That watch is gone." };
  // Carry the existing options over. Rebuilding notify from scratch dropped
  // `redact`, so a watch deliberately set to hide its value would start
  // publishing it — at the exact moment it moves into a group, where more
  // people are watching.
  // setWatchNotify, not setWatch: this only moves where alerts go, and setWatch
  // resets the baseline. Going through it meant a change that happened while
  // the chat was being set up was swallowed and recorded as the new normal.
  await setWatchNotify(w.id, owner, {
    ...(watch.notify ?? {}),
    channel: "telegram",
    chatId,
  });
  return {
    text: `"${w.name}" will send its alerts here from now on. Anyone in this chat will see them.`,
  };
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
        // Was: "record a skill that picks something up from the page" — which
        // described a flow that did not exist. Recording captured clicks and
        // typing; reading a value meant hand-writing a CSS selector in the skill
        // editor, so anyone following this advice recorded another action skill
        // and hit the same wall.
        "When you record, turn on *Capture a value* and click the thing you want watched: an order status, a price, a stock count, a balance. Then come back here and send /watch again.",
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

/**
 * A tap on an alert's own buttons.
 *
 * Ownership is re-checked here, not trusted from the message: callback data
 * comes back from the client, and an old alert forwarded into another chat must
 * not become a way to pause somebody else's watch.
 */
export async function handleAlertAction(
  chatId: string,
  data: string,
  actingOwner?: string,
): Promise<Reply | null> {
  if (!data.startsWith("a|")) return null;
  // Supplied by the webhook, which resolves it from whoever tapped rather than
  // from the room the message is sitting in.
  const owner = actingOwner ?? (await ownerForChat(chatId));
  if (!owner) return NOT_LINKED;
  const [, action, scheduleId] = data.split("|");
  if (!scheduleId) return null;

  const w = await getWatch(scheduleId);
  if (!w || w.owner !== owner) {
    return { text: "That watch is gone, or it isn't yours." };
  }
  const all = await listSchedules(owner);
  const sched = all.find((x) => x.id === scheduleId);
  const name = sched?.skillName ?? "that watch";

  if (action === "p") {
    await setScheduleActive(scheduleId, owner, false);
    return {
      text: `Paused "${name}". It keeps everything it has learned. Send /watches and resume it whenever.`,
    };
  }
  if (action === "c") {
    const r = await checkNow(owner, scheduleId, name);
    return r;
  }
  return null;
}

/**
 * Run a watch's check right now.
 *
 * "Has it changed yet?" is the commonest thing anyone wants from an alert, and
 * until now the only answer was to wait for the next cadence.
 */
async function checkNow(owner: string, scheduleId: string, name: string): Promise<Reply> {
  const w = await getWatch(scheduleId);
  if (!w || w.owner !== owner) return { text: "That watch is gone, or it isn't yours." };

  const all = await listSchedules(owner);
  const sched = all.find((x) => x.id === scheduleId);
  if (!sched) return { text: "That watch is gone." };

  const tier = computeTier(await getAemulusBalance(owner));
  const session = { pubkey: owner, level: tier.level, tier: tier.name } as never;
  const q = await getQuota(session, "watch");
  if (!q.ok) {
    return {
      text: [
        "You've used all your checks for today, so I can't look right now.",
        "",
        "It resets on a rolling 24 hours, and your scheduled checks pick up again by themselves.",
      ].join("\n"),
    };
  }

  const skill = await getSkill(sched.skillId);
  if (!skill) return { text: "That skill no longer exists." };

  const { startRun } = await import("./run-service");
  try {
    await startRun({
      skill,
      input: sched.input,
      runner: owner,
      scheduleId,
      isWatch: true,
      quota: quotaReserveForWatch(tier.level),
    });
  } catch {
    // The soft check above passed but the atomic reserve refused: a scheduled
    // check landed in the same instant. Nothing was started, and saying so is
    // better than an error the person cannot act on.
    return {
      text: "A scheduled check just took the last slot for today. Nothing lost — that check covers you.",
    };
  }
  // A muted watch checks but stays silent, so a manual check would have
  // promised a message it was never going to send. Asking explicitly is the
  // opposite of not wanting to be disturbed, so the mute lifts here rather than
  // the answer being swallowed.
  const wasMuted = w.mutedUntil != null && w.mutedUntil > Date.now();
  if (wasMuted) await muteUntil(scheduleId, owner, null);

  return {
    text: wasMuted
      ? `Checking "${name}" now. It was muted, so I've unmuted it — you asked, so you'll hear the answer.`
      : `Checking "${name}" now. I'll message you only if it's different from last time.`,
  };
}

/** A button press. Returns null when the data isn't ours. */
export async function handleCallback(
  chatId: string,
  data: string,
  actingOwner?: string,
): Promise<Reply | null> {
  if (!data.startsWith("w|")) return null;
  const owner = actingOwner ?? (await ownerForChat(chatId));
  if (!owner) return NOT_LINKED;
  const [, kind, skillId, key, cadence] = data.split("|");

  const skill = skillId ? await getSkill(skillId) : null;
  // Callback data is client-supplied, so a stale button must not become a way to
  // watch somebody else's PRIVATE skill. A published one is different: anyone
  // can run it, that is what the marketplace is, and every preset in /alerts is
  // a published skill owned by whoever recorded it rather than by the person
  // tapping. Requiring ownership here made the whole preset flow impossible.
  if (!skill || (skill.owner !== owner && !skill.published)) {
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
    // Only cadences this wallet can actually sustain. Offering "Every hour" to
    // someone who cannot pay for 24 checks a day meant the scheduler accepted
    // the watch and then skipped every firing, which looks exactly like a watch
    // that quietly broke.
    const tier = computeTier(await getAemulusBalance(owner));
    const affordable = new Set(affordableCadences(watchLimitForLevel(tier.level)));
    const rows = CADENCES.filter((c) => affordable.has(c.c))
      .map((c) => ({
        text: c.label,
        data: `w|c|${skill.id}|${key}|${c.c}`,
      }))
      .filter((b) => b.data.length <= MAX_CB)
      .map((b) => [b]);
    if (rows.length === 0) {
      return {
        text: [
          "Your wallet's tier doesn't cover any checking schedule right now.",
          "",
          "Send /quota to see where you are.",
        ].join("\n"),
      };
    }
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
    // The rule the user set WHILE RECORDING, when it is for the key they just
    // picked. Without this, the answer given at the only moment they were
    // looking at the value is thrown away here — on the surface most watches
    // are actually created from — and every watch silently becomes
    // "tell me when it changes".
    //
    // Held to the same two tests the site and the API apply before they will
    // attach a rule. This surface used to check only the first one, so a
    // numeric rule recorded against a capture that collects a LIST was refused
    // with a 400 on the site and accepted here — and it is here that most
    // watches are made. The comparison would not fail; it would compare the
    // first number in the list and answer confidently about the wrong thing.
    // Falling back to "changed" keeps the watch, loses only the unusable rule.
    const fromRecording = recordedRule(skill.plan, key);
    const rule: WatchRule =
      fromRecording &&
      fromRecording.key === key &&
      ruleIsUsable(fromRecording) &&
      ruleFitsCapture(fromRecording, skill.plan)
        ? fromRecording
        : { key, op: "changed" };
    await setWatch(scheduleId, owner, rule, { channel: "telegram", chatId });
    return {
      text: [
        "*Watch created*",
        "",
        `I'll run *${mdEscape(skill.name)}* ${cad.label.toLowerCase()} and look at *${mdEscape(key)}*.`,
        `That's about ${cad.perDay} ${cad.perDay === 1 ? "run" : "runs"} a day out of your quota.`,
        "",
        rule.op === "changed"
          ? "You'll hear from me only when that value is different from the time before. The very first check has nothing to compare against, so it just records what's there now and stays quiet."
          : `You'll hear from me ${ruleSentence(rule)} — the rule you set while recording.`,
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

/** Rough, human, and never precise enough to be wrong in an interesting way. */
function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
