import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderDigest } from "../lib/wallet-digest";

/**
 * The one path that serves creators rather than watchers.
 *
 * Its main risk is being boring. A daily message saying nothing happened is how
 * a bot gets muted, and a muted bot takes the alerts that matter with it.
 */
describe("the creator digest", () => {
  it("names the number that needs acting on", () => {
    const out = renderDigest({
      lines: [{ skill: "Order status", runs: 41, rate: 0.71 }],
      claimable: 1940,
    });
    expect(out).toContain("41 runs");
    expect(out).toContain("71.0%");
    // A slipping rate usually means the page changed, and the author is the only
    // person who can fix it. Saying so is the whole point of sending this.
    expect(out).toContain("page it runs on may have changed");
    expect(out).toContain("1,940 $AEMU claimable");
  });

  it("stays quiet about a rate that is fine", () => {
    const out = renderDigest({
      lines: [{ skill: "Order status", runs: 41, rate: 0.99 }],
      claimable: 0,
    });
    expect(out).not.toContain("may have changed");
    // Nothing to collect, so nothing about collecting.
    expect(out).not.toContain("claimable");
  });

  it("says plainly when nobody ran anything", () => {
    const out = renderDigest({ lines: [], claimable: 0 });
    expect(out).toContain("Nobody ran a published skill");
  });

  // Skill names come from users and go into a markdown message; an unbalanced
  // underscore makes Telegram reject the whole thing, so the alert never lands.
  it("escapes a skill name that would break the message", () => {
    const out = renderDigest({
      lines: [{ skill: "order_status_v2", runs: 3, rate: 1 }],
      claimable: 0,
    });
    expect((out.match(/(?<!\\)_/g) || []).length).toBe(0);
  });

  // buildDigest reads a week of runs per skill, so a sweep can outlast the tick
  // that started it — and the "already sent" mark only lands after that work.
  // Without a guard, the next tick picks up the same chats and sends twice.
  it("refuses to run on top of itself", () => {
    const src = readFileSync("lib/wallet-digest.ts", "utf8");
    expect(src).toMatch(/sweeping/);
    expect(src).toMatch(/finally\s*\{\s*sweeping = false/);
  });

  // A creator with a lot of published skills should not get an unreadable wall,
  // and should not be told a partial list is the whole list.
  it("says how many it left out rather than dropping them silently", () => {
    const out = renderDigest({
      lines: [{ skill: "A", runs: 10, rate: 1 }],
      claimable: 0,
      others: 4,
    });
    expect(out).toContain("4 more");
  });

  it("says nothing about a remainder when there isn't one", () => {
    const out = renderDigest({ lines: [{ skill: "A", runs: 10, rate: 1 }], claimable: 0, others: 0 });
    expect(out).not.toContain("more that ran");
  });
});
