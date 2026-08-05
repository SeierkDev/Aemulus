import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { Run } from "../lib/types";

/**
 * A schedule that fails keeps failing.
 *
 * At every 30 minutes that is 48 identical messages a day about one broken
 * skill, and the person mutes the bot — which also mutes their watches, because
 * it is the same chat. So repeats collapse to one an hour.
 */
const sent: { chat: string; text: string }[] = [];

// Only the private-chat lookup is stubbed. If the module ever goes back to
// chatsForOwner, these tests fail with "not a function" rather than quietly
// passing while alerts reach rooms again.
vi.mock("../lib/telegram", () => ({
  telegramEnabled: () => true,
  privateChatsForOwner: async () => ["chat_1"],
  sendMessage: async (chat: string, text: string) => { sent.push({ chat, text }); },
  mdEscape: (s: string) => s,
}));

const { alertRunFinished } = await import("../lib/run-alert-telegram");

const run = (over: Partial<Run> = {}) =>
  ({
    id: "run_1", owner: "w1", skillId: "skl_1", status: "failed",
    error: "it broke", scheduleId: "sch_1", output: null,
    ...over,
  }) as unknown as Run;

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

describe("repeat suppression", () => {
  beforeEach(() => { sent.length = 0; });

  it("says it once, not every cadence", async () => {
    for (let i = 0; i < 6; i++) {
      await alertRunFinished(run({ id: `run_${i}` }), "Nightly sync", T0 + i * 60_000);
    }
    expect(sent).toHaveLength(1);
  });

  it("says it again after an hour, because it is still broken", async () => {
    await alertRunFinished(run(), "Nightly sync", T0 + 10 * HOUR);
    await alertRunFinished(run(), "Nightly sync", T0 + 10 * HOUR + 61 * 60_000);
    expect(sent).toHaveLength(2);
  });

  // Suppression is per skill and per status: a second skill breaking is news,
  // and a run that starts needing review is a different thing to be told.
  it("does not silence a different skill or a different outcome", async () => {
    const t = T0 + 20 * HOUR;
    await alertRunFinished(run(), "Skill A", t);
    await alertRunFinished(run({ skillId: "skl_2" }), "Skill B", t);
    await alertRunFinished(run({ status: "needs_review" }), "Skill A", t);
    expect(sent).toHaveLength(3);
  });

  it("stays silent for a run nobody needs to hear about", async () => {
    await alertRunFinished(run({ status: "completed", scheduleId: null }), "Manual", T0 + 40 * HOUR);
    expect(sent).toHaveLength(0);
  });

  /**
   * A group link is consent for a WATCH to reach a room — that is what /here
   * does. It is not consent for the owner's account activity: every failure of
   * every skill they own, with the error text, announced to a trading group.
   * The daily digest already made this call, filtering to chat_type='private'
   * so a wallet summary never reaches a room. Same reasoning, same rule.
   */
  it("asks only for private chats, never every linked chat", async () => {
    const src = readFileSync("lib/run-alert-telegram.ts", "utf8");
    expect(src).toMatch(/privateChatsForOwner/);
    expect(src).not.toMatch(/\bchatsForOwner\b(?!\w)/);
  });
});

/**
 * The only alert that changes the outcome instead of reporting it.
 *
 * A captcha or an interactive checkpoint parks the run and holds the browser
 * open for a few minutes. Nobody was told, so the owner learned about it from
 * the needs_review message afterwards — accurate, and far too late to have done
 * anything about it.
 */
describe("a run paused for a person", () => {
  beforeEach(() => { sent.length = 0; });

  it("says so while the window is still open", async () => {
    const { alertRunPaused } = await import("../lib/run-alert-telegram");
    await alertRunPaused({ id: "run_p1", owner: "w1" }, "Invoice sync", 300_000, T0 + 100 * HOUR);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/needs you/);
    expect(sent[0].text).toMatch(/5 minutes/);
  });

  // Keyed on the run, not the skill. The hourly collapse that stops a failing
  // schedule shouting every cadence would otherwise silence a second run's
  // pause and cost it the window it was waiting in.
  it("does not let one run's pause silence another's", async () => {
    const { alertRunPaused } = await import("../lib/run-alert-telegram");
    const t = T0 + 110 * HOUR;
    await alertRunPaused({ id: "run_a", owner: "w1" }, "S", 300_000, t);
    await alertRunPaused({ id: "run_b", owner: "w1" }, "S", 300_000, t + 1000);
    expect(sent).toHaveLength(2);
  });

  it("says it once for the same run", async () => {
    const { alertRunPaused } = await import("../lib/run-alert-telegram");
    const t = T0 + 120 * HOUR;
    await alertRunPaused({ id: "run_c", owner: "w1" }, "S", 300_000, t);
    await alertRunPaused({ id: "run_c", owner: "w1" }, "S", 300_000, t + 1000);
    expect(sent).toHaveLength(1);
  });

  // Both sites that park a run must announce it, or the one that does not is a
  // silent dead end for whoever hits it.
  it("fires from both places a run can park", () => {
    const src = readFileSync("lib/runner.ts", "utf8");
    const calls = src.match(/alertRunPaused\(/g) ?? [];
    expect(calls).toHaveLength(2);
    const parks = src.match(/setRunStatus\(runId, "awaiting_input"\)/g) ?? [];
    expect(calls.length).toBe(parks.length);
  });
});
