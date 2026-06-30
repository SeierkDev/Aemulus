import { describe, expect, it } from "vitest";
import {
  registerLive,
  waitForResume,
  resumeLive,
  unregisterLive,
  liveSessionActive,
} from "../lib/live";
import type { Page } from "playwright";

// Minimal Page-like stub: no real browser. CDP throws (caught), so the session
// registers without a screencast; the pause/resume control plane is what we test.
const fakePage = {
  context: () => ({
    newCDPSession: async () => {
      throw new Error("no browser in test");
    },
  }),
  url: () => "https://example.com",
} as unknown as Page;

describe("live takeover control plane", () => {
  it("resumes when signaled", async () => {
    await registerLive("run_live_1", fakePage);
    expect(liveSessionActive("run_live_1")).toBe(true);
    const waited = waitForResume("run_live_1", 5_000);
    expect(resumeLive("run_live_1")).toBe(true);
    expect(await waited).toBe("resumed");
    await unregisterLive("run_live_1");
    expect(liveSessionActive("run_live_1")).toBe(false);
  });

  it("times out if no human responds", async () => {
    await registerLive("run_live_2", fakePage);
    expect(await waitForResume("run_live_2", 20)).toBe("timeout");
    await unregisterLive("run_live_2");
  });

  it("resumeLive is a no-op for an unknown / non-waiting run", async () => {
    expect(resumeLive("nope")).toBe(false);
  });
});
