import { describe, expect, it } from "vitest";
import { affordableCadences, CHECKS_PER_DAY } from "../lib/schedules";
import { watchLimitForLevel } from "../lib/solana";

/**
 * Watch checks are metered separately from runs, and a cadence is only offered
 * when the allowance can sustain it. The scheduler used to accept any cadence
 * and then silently skip the firings it could not pay for, which is
 * indistinguishable from a watch that simply stopped working.
 */

describe("what a tier can afford", () => {
  // The whole reason for a separate allowance: at 5 runs a day, an hourly watch
  // (24 checks) was arithmetically impossible, so the feature did not exist for
  // the entry tier at all.
  it("lets the entry tier run two hourly watches", () => {
    const holder = watchLimitForLevel(1);
    expect(holder).toBeGreaterThanOrEqual(CHECKS_PER_DAY.hourly * 2);
    expect(affordableCadences(holder)).toContain("hourly");
  });

  // 10-minute checks are 144 a day. That is a paid ask, and frequency is the
  // honest place to put the line, because frequency is what a trader is buying.
  it("keeps the fastest cadences away from the entry tier", () => {
    expect(affordableCadences(watchLimitForLevel(1))).not.toContain("every10m");
    expect(affordableCadences(watchLimitForLevel(2))).toContain("every10m");
  });

  it("gives an unlimited tier everything", () => {
    const all = Object.keys(CHECKS_PER_DAY);
    expect(affordableCadences(-1)).toHaveLength(all.length);
  });

  it("offers nothing to a locked wallet", () => {
    expect(affordableCadences(watchLimitForLevel(0))).toEqual([]);
  });

  // Cheapest question first, so a picker reads in the order somebody decides in.
  it("orders cadences from most frequent to least", () => {
    const c = affordableCadences(-1);
    for (let i = 1; i < c.length; i++) {
      expect(CHECKS_PER_DAY[c[i]]).toBeLessThanOrEqual(CHECKS_PER_DAY[c[i - 1]]);
    }
  });
});
