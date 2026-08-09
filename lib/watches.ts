/**
 * Watches: deciding whether something on a page actually changed.
 *
 * A watch is a scheduled run plus a rule over one of the values that run
 * extracted. Every other page monitor diffs pages — pixels, DOM regions, text
 * blobs — which is why they are so noisy: an ad rotates, a timestamp ticks, you
 * get an alert. Aemulus does not have that problem, because a skill already
 * declares what matters. An extract step names its output, so a watch compares
 * ONE named field and ignores everything else on the page.
 *
 * This module is deliberately pure: no database, no Telegram, no clock beyond
 * the `now` it is handed. Everything that decides whether a human gets
 * interrupted lives here and can be tested directly, because the failure mode
 * that kills a monitoring product is not missing an alert — it is sending three
 * you did not want, after which people mute it and never come back.
 */

/**
 * A NOTE ON "appears" / "disappears".
 *
 * They compare the captured TEXT going empty or non-empty — not the element
 * being added to or removed from the page. If the element is gone, the extract
 * step cannot locate it, the run ends in needs_review, and evaluateWatchForRun
 * treats that as a failed check, which is deliberate: a value missing because a
 * login lapsed must not be reported as the value disappearing. That guard is
 * worth more than the convenience, so the UI labels these as "starts/stops
 * showing a value" rather than promising element-removal detection the runner
 * cannot deliver.
 */
/**
 * Every operator a rule may use — the one list.
 *
 * It was hand-copied into the zod schema for a skill save, the trace edge, the
 * capture route and back into this file, four places that had to agree and
 * nothing that made them. A copy that gains an op stores rules the evaluator
 * cannot satisfy; a copy that loses one silently discards a rule somebody set.
 * Consumers derive from this now, so drift is a type error rather than a
 * behaviour.
 */
export const WATCH_OPS = [
  "changed",
  "equals",
  "contains",
  "not_contains",
  "above",
  "below",
  "appears",
  "disappears",
] as const;

export type WatchOp = (typeof WATCH_OPS)[number];

/**
 * The operators that make sense for a WAIT, in the order a person picks them.
 *
 * "changed" is deliberately absent. A watch compares this check against the
 * last one, so change is the thing it can see; a wait has no previous reading
 * to compare against, only what the page says right now. Offering it would
 * produce a step that either fires instantly or never, depending on nothing the
 * author can see.
 */
export const WAIT_OPS = [
  "appears",
  "disappears",
  "equals",
  "contains",
  "not_contains",
  "above",
  "below",
] as const;

export type WaitOp = (typeof WAIT_OPS)[number];

/**
 * The longest a single wait may hold.
 *
 * A waiting step keeps its browser and its run slot for the whole duration, so
 * this is a cap on how long one skill can hold the pool open, not a preference.
 * Five minutes covers a slow report or a settling balance; anything that takes
 * longer is a schedule, not a wait.
 */
export const MAX_WAIT_MS = 5 * 60 * 1000;
export const DEFAULT_WAIT_MS = 30_000;

export type WatchRule = {
  /** Which of the run's output keys to watch. */
  key: string;
  op: WatchOp;
  /** Operand for equals / contains / not_contains / above / below. */
  value?: string;
  /**
   * How many consecutive checks must agree before alerting. 1 = alert on the
   * first sighting. 2+ absorbs a value that flickers — an A/B test, a
   * load-balanced backend, a number mid-recalculation.
   */
  confirm?: number;
  /** Minimum gap between alerts for this watch, in ms. */
  cooldownMs?: number;
};

export type WatchState = {
  /** Last value we alerted on, or accepted as the baseline. Normalized. */
  lastValue: string | null;
  /** A candidate seen but not yet confirmed. */
  pendingValue?: string | null;
  /** How many consecutive checks the candidate has held for. */
  pendingCount?: number;
  /** When we last alerted, so cooldown can be enforced. */
  lastAlertAt?: number;
  /** Consecutive failed checks. Reset by any successful check. */
  failStreak: number;
  /**
   * The value at the moment the quiet started, kept only while a mute is on.
   *
   * lastValue keeps moving during a mute so /watches stays truthful about what
   * the page says right now. That alone would lose a one-time flip: socials
   * vanish while muted, the baseline follows them, and at mute-lift nothing
   * differs any more. This is the point the lift compares against, so the net
   * change across the quiet is reported exactly once.
   */
  mutedFrom?: string | null;
  /**
   * When the owner was last told this watch could not run at all (quota gone,
   * tier no longer eligible). Kept so a condition that lasts all day produces
   * one message, not one per tick.
   */
  stalledNoticeAt?: number;
};

export type WatchDecision = {
  /** Send the user a message? */
  notify: boolean;
  /** State to persist. Always returned, even when not notifying. */
  state: WatchState;
  /** For an alert: what it moved from and to. */
  from?: string | null;
  to?: string;
  /** Set when the watch itself is broken rather than the value changing. */
  broken?: boolean;
  /** Human-readable reason, for logs and the "watch is broken" message. */
  note?: string;
};

/** Consecutive failures before we tell the user the watch itself is broken. */
export const BROKEN_AFTER = 3;

export function emptyState(): WatchState {
  return { lastValue: null, failStreak: 0 };
}

/**
 * Normalize before comparing, or the watch alerts on nothing.
 *
 * Zero-width characters and collapsible whitespace change constantly on real
 * pages without the value meaning anything different. Case is NOT folded: for a
 * status field, "Shipped" and "shipped" are the same event, but for a name or a
 * code they are not, and silently equating them would lose real changes.
 */
export function normalize(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull a number out of a human-formatted value: "$1,249.00" → 1249, "-3.5%" →
 * -3.5. Returns null when there is no number to find, which the caller treats
 * as inconclusive rather than as zero — a page that failed to render a price is
 * not a page reporting a price of nothing.
 */
export function parseNumber(s: string): number | null {
  const m = normalize(s)
    .replace(/[ \s]/g, "")
    .match(/-?\d[\d,]*\.?\d*/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Does ONE reading, on its own, satisfy an operator?
 *
 * The single-reading half of the evaluator, shared with waits. A watch asks
 * whether something CHANGED and needs two readings for that; a wait only ever
 * has the page as it is right now, and asks whether it is there yet.
 *
 * `reading` is null when the element could not be found at all, which is the
 * distinction "" cannot carry: an empty field and a missing field are the same
 * string and very different facts. Null satisfies "disappears" and nothing else.
 *
 * Returns null for inconclusive — a number was needed and the page gave
 * something that is not one. A wait treats that as not-yet rather than as
 * failure, because a page mid-render is the normal case for a step that exists
 * to wait for the page to finish.
 */
export function holds(
  op: WaitOp | string,
  operand: string,
  reading: string | null,
): boolean | null {
  const text = reading === null ? "" : normalize(reading);
  switch (op) {
    case "appears":
      return reading !== null && text !== "";
    case "disappears":
      return reading === null || text === "";
    case "equals":
    case "contains":
    case "not_contains":
    case "above":
    case "below":
      // A missing element cannot satisfy a claim about its text. Without this,
      // "not_contains" is true for an element that is not on the page at all,
      // and a wait for it would pass before the page had rendered anything.
      if (reading === null) return false;
      return satisfies({ key: "", op, value: operand } as WatchRule, text);
    default:
      return null;
  }
}

/** Does the value satisfy the rule, given what we saw last time? */
/**
 * Does one reading satisfy the rule, considered on its own?
 *
 * Null means inconclusive — the page gave us something that is not a number
 * where a number was needed.
 */
function satisfies(rule: WatchRule, value: string): boolean | null {
  const operand = rule.value ?? "";
  switch (rule.op) {
    case "equals":
      return value === normalize(operand);
    case "contains":
      return value.includes(normalize(operand));
    case "not_contains":
      return !value.includes(normalize(operand));
    case "above":
    case "below": {
      const a = parseNumber(value);
      const b = parseNumber(operand);
      if (a === null || b === null) return null;
      return rule.op === "above" ? a > b : a < b;
    }
    default:
      return null;
  }
}

/**
 * Does the value satisfy the rule, given what we saw last time?
 *
 * The state predicates — above, below, equals, contains, not_contains — are
 * EDGE-TRIGGERED: they fire when the reading starts satisfying the rule, not
 * for as long as it keeps satisfying it. Comparing only the current reading
 * meant "below 5" matched on every single check while the value stayed below
 * five: an hourly watch sent twenty-four identical messages a day, and once a
 * watch could ACT, it ran the skill twenty-four times a day. cooldownMs would
 * have blunted that, but it defaults to none and no screen sets one, so the
 * default behaviour was the broken one. It is also what the words say: "goes
 * below" is a crossing, not a state.
 *
 * A missing baseline counts as NOT satisfied, so a watch created on a page that
 * already meets the rule still reports it once — losing that would be a real
 * loss, and it is the behaviour people already have. (The ACTION separately
 * waits for a baseline; see watch-runner.)
 */
function matches(rule: WatchRule, prev: string | null, next: string): boolean | null {
  switch (rule.op) {
    case "changed":
      // No baseline yet is not a change. The first check establishes what
      // "normal" is; alerting on it would fire an alert for every new watch.
      return prev !== null && prev !== next;
    case "appears":
      return prev !== null && prev === "" && next !== "";
    case "disappears":
      return prev !== null && prev !== "" && next === "";
    default: {
      const now = satisfies(rule, next);
      if (now === null) return null; // inconclusive: change nothing
      if (!now) return false;
      // Inconclusive on the PREVIOUS reading is treated as not-satisfied: the
      // alternative is swallowing a real crossing because the page was
      // unreadable once.
      const before = prev === null ? false : satisfies(rule, prev) === true;
      return !before;
    }
  }
}

/**
 * A check that could not be performed — the run failed, or the field was not
 * captured at all.
 *
 * A failure must NEVER look like a change. If a login expires and the page
 * stops rendering the value, "$1,249" becoming "" is not a price drop, and
 * telling someone their balance vanished would be worse than saying nothing.
 * So a failed check leaves lastValue untouched and only counts toward telling
 * the user their watch is broken.
 */
export function evaluateFailure(state: WatchState, note?: string): WatchDecision {
  const failStreak = state.failStreak + 1;
  const next: WatchState = { ...state, failStreak };
  if (failStreak === BROKEN_AFTER) {
    return {
      notify: true,
      broken: true,
      state: next,
      note: note || "This watch has failed several times in a row.",
    };
  }
  return { notify: false, state: next };
}

/**
 * A check that succeeded. `raw` is the value the run extracted.
 */
export function evaluate(
  rule: WatchRule,
  state: WatchState,
  raw: string,
  now: number,
): WatchDecision {
  const next = normalize(raw);
  const confirm = Math.max(1, Math.floor(rule.confirm ?? 1));
  // A successful check clears the failure streak, whatever else it decides.
  const base: WatchState = { ...state, failStreak: 0 };

  const hit = matches(rule, state.lastValue, next);

  // Inconclusive (an unparseable number). Change nothing: not a match, and not
  // a new baseline either, or the next real reading would look like a change
  // from garbage.
  if (hit === null) {
    return { notify: false, state: base, note: "Value could not be read as a number." };
  }

  if (!hit) {
    // No match. For "changed" the value still becomes the baseline — the first
    // check has to establish one, and a value that keeps matching is the new
    // normal. Any pending candidate is abandoned.
    return {
      notify: false,
      state: { ...base, lastValue: next, pendingValue: null, pendingCount: 0 },
    };
  }

  // It matched. Does it hold long enough?
  if (confirm > 1) {
    const held = state.pendingValue === next ? (state.pendingCount ?? 0) + 1 : 1;
    if (held < confirm) {
      return {
        notify: false,
        state: { ...base, pendingValue: next, pendingCount: held },
        note: `Seen ${held}/${confirm}.`,
      };
    }
  }

  // Cooldown: a value oscillating around a threshold must not be able to
  // interrupt someone repeatedly. The baseline still advances, so the state
  // stays truthful — only the message is suppressed.
  const cooldown = Math.max(0, rule.cooldownMs ?? 0);
  const since = now - (state.lastAlertAt ?? 0);
  if (cooldown > 0 && state.lastAlertAt !== undefined && since < cooldown) {
    return {
      notify: false,
      state: { ...base, lastValue: next, pendingValue: null, pendingCount: 0 },
      note: "Suppressed by cooldown.",
    };
  }

  return {
    notify: true,
    from: state.lastValue,
    to: next,
    state: {
      lastValue: next,
      pendingValue: null,
      pendingCount: 0,
      lastAlertAt: now,
      failStreak: 0,
    },
  };
}

/** Ops that compare against an operand the user has to supply. */
export const OPS_NEEDING_VALUE: WatchOp[] = [
  "equals",
  "contains",
  "not_contains",
  "above",
  "below",
];

/**
 * Is this rule actually satisfiable?
 *
 * "below" with no number is not a stricter rule, it is a DEAD one: parseNumber
 * returns null for an empty operand, matches() then answers inconclusive, and
 * the watch runs every cadence forever without ever being able to fire. It
 * looks armed on the schedules page and burns the watch allowance the whole
 * time. Refusing it at the edge is the only place that can tell the difference,
 * because by the time it is stored it is indistinguishable from a rule whose
 * page is simply not changing.
 */
export function ruleIsUsable(rule: { op: WatchOp; value?: string }): boolean {
  if (!OPS_NEEDING_VALUE.includes(rule.op)) return true;
  return (rule.value ?? "").trim().length > 0;
}

/** Numeric comparisons — meaningless against a captured LIST. */
export const NUMERIC_OPS: WatchOp[] = ["above", "below"];

/**
 * Does this rule make sense against the thing it watches?
 *
 * A loop capture stores every matching element as a JSON array, and
 * parseNumber's regex happily finds the first number anywhere in that string —
 * measured, ["42 items","7 items"] parses as 42. So "alert when below 5" on a
 * list does not fail loudly, it silently watches whatever number happens to
 * appear first and reports it as if it were the list. Wrong answers are worse
 * than refusals, so the pairing is refused instead.
 */
export function ruleFitsCapture(
  rule: { key: string; op: WatchOp | string },
  steps: { action: string; outputKey?: string; loop?: boolean }[],
): boolean {
  if (!NUMERIC_OPS.includes(rule.op as WatchOp)) return true;
  const step = (steps ?? []).find(
    (s) => s.action === "extract" && (s.outputKey ?? "") === rule.key,
  );
  // Unknown key: not this function's call to make. The route already resolves
  // the skill, and a key that matches no capture fails elsewhere.
  return !step?.loop;
}

/**
 * The rule in plain words, for a confirmation message.
 *
 * A watch created from a recorded rule behaves differently from the default
 * "tell me when it changes", and saying which one is in force is the difference
 * between a quiet watch working and a quiet watch looking broken.
 */
export function ruleSentence(rule: { key: string; op: string; value?: string }): string {
  const k = rule.key;
  switch (rule.op) {
    case "above":
      return `when ${k} goes above ${rule.value}`;
    case "below":
      return `when ${k} goes below ${rule.value}`;
    case "equals":
      return `when ${k} becomes "${rule.value}"`;
    case "contains":
      return `when ${k} contains "${rule.value}"`;
    case "not_contains":
      return `when ${k} stops containing "${rule.value}"`;
    case "appears":
      return `when ${k} starts showing a value`;
    case "disappears":
      return `when ${k} stops showing a value`;
    default:
      return `when ${k} is different from the time before`;
  }
}

/**
 * The rule a skill was recorded with, if any.
 *
 * A capture can carry the answer to "when do you care" from the moment it was
 * made — the only moment the person is actually looking at the value. This
 * turns that into a WatchRule so a watch can be created without asking the
 * question again, out of context, days later.
 *
 * Returns null when nothing was recorded, which is every skill made before
 * v0.1.3 and every capture the user did not put a rule on.
 */
export function recordedRule(
  steps: { action: string; outputKey?: string; watchOp?: string; watchValue?: string }[],
  /**
   * Which capture the rule is wanted for.
   *
   * Without this it answers with the FIRST rule in the recording, whatever
   * capture you are actually watching. Record two values with a rule each —
   * price below 5, status equals sold — ask for the second, and you were handed
   * the first; the key did not match, so it was thrown away and the watch
   * silently became "tell me when it changes". Which is the exact loss this
   * function exists to prevent, just one capture further in.
   */
  forKey?: string,
): WatchRule | null {
  const want = (forKey ?? "").trim();
  for (const s of steps ?? []) {
    if (s.action !== "extract") continue;
    const key = (s.outputKey ?? "").trim();
    if (want && key !== want) continue;
    const op = (s.watchOp ?? "").trim() as WatchOp;
    if (!key || !(WATCH_OPS as readonly string[]).includes(op)) continue;
    const value = (s.watchValue ?? "").trim();
    // An operand-taking op with no operand is not a rule, it is half of one.
    // Falling back to "changed" keeps the capture useful instead of creating a
    // watch that can never be satisfied.
    const needsValue = OPS_NEEDING_VALUE.includes(op);
    if (needsValue && !value) return { key, op: "changed" };
    return needsValue ? { key, op, value } : { key, op };
  }
  return null;
}
