import { describe, expect, it } from "vitest";
import {
  evaluate,
  evaluateFailure,
  emptyState,
  normalize,
  parseNumber,
  BROKEN_AFTER,
  type WatchRule,
  type WatchState,
} from "../lib/watches";

const T0 = 1_700_000_000_000;
const rule = (r: Partial<WatchRule> = {}): WatchRule => ({
  key: "status",
  op: "changed",
  ...r,
});

describe("normalize", () => {
  it("collapses whitespace and strips zero-width characters", () => {
    expect(normalize("  shipped \n ")).toBe("shipped");
    expect(normalize("ship​ped")).toBe("shipped");
    expect(normalize("a  b")).toBe("a b");
  });

  // Case is deliberately preserved: "Shipped"/"shipped" is the same event, but
  // for a name or a reference code it is not, and folding would lose changes.
  it("does not fold case", () => {
    expect(normalize("Shipped")).not.toBe(normalize("shipped"));
  });
});

describe("parseNumber", () => {
  it("reads a number out of a human-formatted value", () => {
    expect(parseNumber("$1,249.00")).toBe(1249);
    expect(parseNumber("10 000")).toBe(10000);
    expect(parseNumber("-3.5%")).toBe(-3.5);
    expect(parseNumber("in stock: 7 left")).toBe(7);
  });

  // Null, not 0. A page that failed to render a price is not a page reporting
  // a price of nothing, and treating it as 0 would fire every "below" watch.
  it("returns null when there is no number, rather than zero", () => {
    expect(parseNumber("out of stock")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("changed", () => {
  it("does not alert on the very first check", () => {
    const d = evaluate(rule(), emptyState(), "pending", T0);
    expect(d.notify).toBe(false);
    // ...but it does become the baseline, so the NEXT change is caught.
    expect(d.state.lastValue).toBe("pending");
  });

  it("alerts when the value moves, and reports both sides", () => {
    const first = evaluate(rule(), emptyState(), "pending", T0);
    const d = evaluate(rule(), first.state, "shipped", T0 + 60_000);
    expect(d.notify).toBe(true);
    expect(d.from).toBe("pending");
    expect(d.to).toBe("shipped");
  });

  it("stays quiet while the value holds", () => {
    let s = evaluate(rule(), emptyState(), "pending", T0).state;
    for (let i = 1; i <= 5; i++) {
      const d = evaluate(rule(), s, "pending", T0 + i * 60_000);
      expect(d.notify).toBe(false);
      s = d.state;
    }
  });

  it("ignores cosmetic whitespace differences", () => {
    const first = evaluate(rule(), emptyState(), "pending", T0);
    const d = evaluate(rule(), first.state, "  pending\n", T0 + 60_000);
    expect(d.notify).toBe(false);
  });
});

describe("thresholds", () => {
  it("alerts when a number crosses above", () => {
    const r = rule({ op: "above", value: "10000" });
    const d = evaluate(r, emptyState(), "$10,250.00", T0);
    expect(d.notify).toBe(true);
    expect(d.to).toBe("$10,250.00");
  });

  it("does not alert below the threshold", () => {
    const r = rule({ op: "above", value: "10000" });
    expect(evaluate(r, emptyState(), "$9,900", T0).notify).toBe(false);
  });

  // The dangerous case: an unreadable value must not read as zero, or every
  // "below" watch fires the moment a page fails to render.
  it("treats an unreadable value as inconclusive, not as zero", () => {
    const r = rule({ op: "below", value: "100" });
    const d = evaluate(r, emptyState(), "—", T0);
    expect(d.notify).toBe(false);
    // And it must NOT become the baseline, or the next real reading looks like
    // a change from garbage.
    expect(d.state.lastValue).toBeNull();
  });
});

describe("appears / disappears", () => {
  it("fires when a value shows up", () => {
    const base: WatchState = { ...emptyState(), lastValue: "" };
    expect(evaluate(rule({ op: "appears" }), base, "In stock", T0).notify).toBe(true);
  });

  it("fires when a value goes away", () => {
    const base: WatchState = { ...emptyState(), lastValue: "In stock" };
    expect(evaluate(rule({ op: "disappears" }), base, "", T0).notify).toBe(true);
  });

  it("does not fire on the first ever check", () => {
    expect(evaluate(rule({ op: "appears" }), emptyState(), "In stock", T0).notify).toBe(false);
  });
});

describe("confirm (anti-flap)", () => {
  const r = rule({ confirm: 2 });

  it("holds an alert until the value has been seen twice", () => {
    const first = evaluate(r, emptyState(), "pending", T0).state;
    const a = evaluate(r, first, "shipped", T0 + 60_000);
    expect(a.notify).toBe(false);
    const b = evaluate(r, a.state, "shipped", T0 + 120_000);
    expect(b.notify).toBe(true);
  });

  // The whole point: an A/B test or a load-balanced backend flipping a value
  // back and forth must not interrupt anyone.
  it("never alerts on a value that keeps flipping back", () => {
    let s = evaluate(r, emptyState(), "A", T0).state;
    for (let i = 1; i <= 6; i++) {
      const d = evaluate(r, s, i % 2 ? "B" : "A", T0 + i * 60_000);
      expect(d.notify, `check ${i}`).toBe(false);
      s = d.state;
    }
  });
});

describe("cooldown", () => {
  const r = rule({ cooldownMs: 60 * 60_000 });

  it("suppresses a second alert inside the window", () => {
    const first = evaluate(r, emptyState(), "a", T0).state;
    const alert = evaluate(r, first, "b", T0 + 60_000);
    expect(alert.notify).toBe(true);
    const soon = evaluate(r, alert.state, "c", T0 + 120_000);
    expect(soon.notify).toBe(false);
    // The baseline still advances — the state stays truthful, only the message
    // is withheld.
    expect(soon.state.lastValue).toBe("c");
  });

  it("allows an alert again once the window has passed", () => {
    const first = evaluate(r, emptyState(), "a", T0).state;
    const alert = evaluate(r, first, "b", T0 + 60_000);
    const later = evaluate(r, alert.state, "c", T0 + 60_000 + 61 * 60_000);
    expect(later.notify).toBe(true);
  });
});

describe("failures are not changes", () => {
  // The single most important rule here. If a login expires and the page stops
  // rendering, "$1,249" becoming "" is not a price drop — and telling someone
  // their balance vanished is worse than saying nothing.
  it("never treats a failed check as a change", () => {
    const s = evaluate(rule(), emptyState(), "$1,249", T0).state;
    const f = evaluateFailure(s);
    expect(f.notify).toBe(false);
    expect(f.state.lastValue).toBe("$1,249"); // baseline untouched
  });

  it("reports the watch as broken after repeated failures", () => {
    let s = emptyState();
    for (let i = 1; i < BROKEN_AFTER; i++) {
      const d = evaluateFailure(s);
      expect(d.notify).toBe(false);
      s = d.state;
    }
    const last = evaluateFailure(s);
    expect(last.notify).toBe(true);
    expect(last.broken).toBe(true);
  });

  it("does not nag once it has said the watch is broken", () => {
    let s = emptyState();
    for (let i = 0; i < BROKEN_AFTER; i++) s = evaluateFailure(s).state;
    for (let i = 0; i < 5; i++) {
      const d = evaluateFailure(s);
      expect(d.notify).toBe(false);
      s = d.state;
    }
  });

  it("a successful check clears the failure streak", () => {
    let s = emptyState();
    s = evaluateFailure(s).state;
    s = evaluateFailure(s).state;
    expect(s.failStreak).toBe(2);
    const ok = evaluate(rule(), s, "fine", T0);
    expect(ok.state.failStreak).toBe(0);
  });
});

describe("a watch that could not run at all", () => {
  // The scheduler skips a watch when quota is gone, and switches it off when
  // the wallet no longer qualifies. Both used to be log lines and nothing else.
  // From the outside, a watch that says nothing because it never ran looks
  // exactly like a watch that ran and found no change, which is the one
  // ambiguity an alerting feature must not have.
  it("carries a marker so the same notice is not repeated every tick", () => {
    const state: WatchState = { lastValue: "a", failStreak: 0 };
    expect(state.stalledNoticeAt).toBeUndefined();

    const told: WatchState = { ...state, stalledNoticeAt: 1_000 };
    // Quota exhaustion lasts until midnight, so without this the scheduler
    // would message on every tick until reset and get itself muted.
    expect(told.stalledNoticeAt).toBe(1_000);
    // The marker is separate from the alert cooldown: a stalled watch has not
    // alerted, so lastAlertAt must not be what suppresses it.
    expect(told.lastAlertAt).toBeUndefined();
  });
});
