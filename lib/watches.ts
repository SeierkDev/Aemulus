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

export type WatchOp =
  | "changed"
  | "equals"
  | "contains"
  | "not_contains"
  | "above"
  | "below"
  | "appears"
  | "disappears";

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

/** Does the value satisfy the rule, given what we saw last time? */
function matches(rule: WatchRule, prev: string | null, next: string): boolean | null {
  const operand = rule.value ?? "";
  switch (rule.op) {
    case "changed":
      // No baseline yet is not a change. The first check establishes what
      // "normal" is; alerting on it would fire an alert for every new watch.
      return prev !== null && prev !== next;
    case "equals":
      return next === normalize(operand);
    case "contains":
      return next.includes(normalize(operand));
    case "not_contains":
      return !next.includes(normalize(operand));
    case "appears":
      return prev !== null && prev === "" && next !== "";
    case "disappears":
      return prev !== null && prev !== "" && next === "";
    case "above":
    case "below": {
      const a = parseNumber(next);
      const b = parseNumber(operand);
      // Inconclusive: the page gave us something unparseable. Do not alert, and
      // do not treat it as a threshold crossing in either direction.
      if (a === null || b === null) return null;
      return rule.op === "above" ? a > b : a < b;
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
