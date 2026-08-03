import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillAnalyticsPanel } from "../components/SkillAnalytics";
import type { SkillAnalytics } from "../lib/analytics";

/**
 * Renders the panel for the data shapes that actually occur. The interesting
 * cases are the empty and degenerate ones: a skill published an hour ago, a
 * perfect one, and one with nothing to compare against yet.
 */
const base = (over: Partial<SkillAnalytics> = {}): SkillAnalytics => ({
  skillId: "skl_1", days: 30, runs: 0, succeeded: 0, failed: 0,
  successRate: null, uniqueUsers: 0, earned: 0, claimable: 0,
  tokensIn: 0, tokensOut: 0,
  needsReview: 0, inFlight: 0, repeatUsers: 0, stops: [], byVersion: [], stopsTruncated: false,
  series: Array.from({ length: 30 }, (_, i) => day(i, 0, 0)),
  previous: { runs: 0, successRate: null },
  ...over,
});

/** One bucket. rate is null on a day nothing finished, never 0. */
const day = (i: number, ok: number, failed: number, needsReview = 0) => {
  const settled = ok + failed + needsReview;
  return {
    ts: i * 86400000,
    label: `d${i}`,
    ok,
    failed,
    needsReview,
    rate: settled > 0 ? ok / settled : null,
  };
};

const html = (a: SkillAnalytics) =>
  renderToStaticMarkup(
    createElement(SkillAnalyticsPanel, {
      windows: { 7: a, 30: a, 90: a },
      skillName: "Test skill",
      skillId: "skl_1",
    }),
  );

describe("the analytics panel renders", () => {
  it("never prints NaN, Infinity or undefined for any shape", () => {
    const shapes = [
      base(),
      base({ runs: 10, succeeded: 10, successRate: 1, uniqueUsers: 3 }),
      base({
        runs: 9, succeeded: 3, failed: 6, successRate: 1 / 3, uniqueUsers: 2,
        earned: 12.5, claimable: 4.5, tokensIn: 900, tokensOut: 120,
        series: Array.from({ length: 30 }, (_, i) => day(i, i % 3, i % 2)),
        previous: { runs: 20, successRate: 0.9 },
      }),
    ];
    for (const a of shapes) {
      expect(html(a)).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  // A skill published an hour ago must not be told it fails 100% of the time.
  it("shows an unknown rate as a dash and explains the emptiness", () => {
    const out = html(base());
    expect(out).toContain("No finished runs in this window yet");
    expect(out).not.toContain("0.0%");
  });

  // The failure callout is the reason this page exists: it must show up when
  // things go wrong and stay quiet when they do not.
  it("warns only when runs actually failed", () => {
    const bad = html(base({
      runs: 9, succeeded: 3, failed: 6, successRate: 1 / 3,
      series: [day(0, 3, 6)],
    }));
    expect(bad).toContain("the page changed");

    const good = html(base({
      runs: 9, succeeded: 9, failed: 0, successRate: 1,
      series: [day(0, 9, 0)],
    }));
    expect(good).not.toContain("the page changed");
  });

  it("renders a bar for every day in the window", () => {
    const a = base({
      runs: 30, succeeded: 30, successRate: 1,
      series: Array.from({ length: 30 }, (_, i) => day(i, 1, 0)),
    });
    expect((html(a).match(/rounded-t-\[4px\]/g) || []).length).toBe(30);
  });

  // "Unchanged" describes a steady state somebody measured. A skill nobody has
  // run yet has not held steady at zero.
  it("does not tell a brand new skill its numbers are unchanged", () => {
    const out = html(base());
    expect(out).toContain("no runs yet");
    expect(out).not.toContain("unchanged");
  });

  // A cap nobody is told about reads as "these are all of them".
  it("says so when the stop list was truncated", () => {
    const many = base({
      runs: 20, succeeded: 5, failed: 15, successRate: 0.25,
      series: [day(0, 5, 15)],
      stops: Array.from({ length: 5 }, (_, i) => ({ idx: i, intent: `step ${i}`, stops: 3 })),
      stopsTruncated: true,
    });
    expect(html(many)).toContain("there were others");

    const few = base({
      runs: 20, succeeded: 5, failed: 15, successRate: 0.25,
      series: [day(0, 5, 15)],
      stops: [{ idx: 0, intent: "only one", stops: 15 }],
    });
    expect(html(few)).not.toContain("there were others");
  });

  // The regression this guards: a rate of 0% in both periods is a skill failing
  // every single run, which is the one thing this page exists to surface. It
  // must never be reported as "no runs yet".
  it("does not hide a totally broken skill behind an empty-state message", () => {
    const broken = base({
      runs: 10, succeeded: 0, failed: 10, successRate: 0, uniqueUsers: 4,
      series: [day(0, 0, 10)],
      previous: { runs: 10, successRate: 0 },
    });
    const out = html(broken);
    expect(out).toContain("0.0%");
    expect(out).not.toContain("no runs yet");
    // Zero to zero on a rate genuinely is unchanged, and saying so is honest.
    expect(out).toContain("unchanged");
  });

  // Earned is windowed, unclaimed is all time. Side by side and unlabelled, a
  // short window showing less earned than claimable reads as a broken sum.
  it("labels the two money figures with their different time bases", () => {
    const out = html(base({
      runs: 3, succeeded: 3, successRate: 1,
      series: [day(0, 3, 0)],
      earned: 40, claimable: 1940,
    }));
    expect(out).toContain("in this window");
    expect(out).toContain("unclaimed all time");
  });
});
