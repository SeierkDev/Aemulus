import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ALERT_PRESETS, livePresets, presetById } from "../lib/alert-pack";
import { CHECKS_PER_DAY } from "../lib/schedules";

/**
 * The curated list is the front door for people who will never record a task.
 * Its job is to be honest about what it can actually do.
 */
describe("the alert pack", () => {
  it("suggests a cadence that exists", () => {
    for (const p of ALERT_PRESETS) {
      expect(CHECKS_PER_DAY[p.suggested]).toBeGreaterThan(0);
    }
  });

  // A preset with no recorded skill must render as "coming", never as a toggle
  // that quietly does nothing — which is exactly the trap the /market templates
  // fell into.
  it("only calls a preset live when a skill is actually behind it", () => {
    for (const p of livePresets()) expect(p.skillId).toBeTruthy();
    expect(livePresets().length).toBeLessThanOrEqual(ALERT_PRESETS.length);
  });

  it("has stable, unique ids to key a toggle on", () => {
    const ids = ALERT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(presetById(id)?.id).toBe(id);
  });

  // The last row is the product: the list is a shortcut, not the boundary.
  it("keeps an escape hatch for a page nobody thought of", () => {
    expect(ALERT_PRESETS.at(-1)?.id).toBe("any-page");
  });

  // Everything here has to work without the browser extension, or the first tap
  // hits the same wall the list was built to remove.
  it("asks for a url wherever the page is not fixed", () => {
    for (const p of ALERT_PRESETS) {
      if (p.ask) expect(p.ask.placeholder).toMatch(/^https/);
    }
  });

  // The page cannot create a watch itself — the wizard lives in the bot — so a
  // ready preset has to hand the choice over. Rendering a control that looks
  // live and does nothing is the trap the marketplace templates fell into, and
  // the one this list exists to avoid repeating.
  it("hands a ready preset to the bot instead of faking a control", () => {
    const page = readFileSync("app/alerts/page.tsx", "utf8");
    expect(page).toMatch(/start=alert_/);
    const hook = readFileSync("app/api/telegram/webhook/route.ts", "utf8");
    // ...and the bot has to understand what it was handed.
    expect(hook).toMatch(/alert_/);
    expect(hook).toMatch(/presetById/);
  });

  // A preset id travels through a Telegram deep link, which is not a place for
  // anything needing escaping.
  it("keeps preset ids link-safe", () => {
    for (const p of ALERT_PRESETS) expect(p.id).toMatch(/^[a-z0-9-]+$/);
  });
});
