import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Run } from "../lib/types";
import type { WatchState } from "../lib/watches";

/**
 * What a mute is allowed to cost you.
 *
 * Muting is what people actually reach for instead of pausing — an alert fires
 * at 3am, they want quiet, and they expect to be told what happened when they
 * come back. The trap is that suppressing the MESSAGE while still advancing the
 * BASELINE silently discards the change: socials vanish from a coin page during
 * a mute, the baseline becomes "gone", the mute lifts, and nothing differs any
 * more. The one alert the watch existed for never arrives, and nothing in the
 * product ever says so.
 *
 * That is fine for a counter drifting 41 → 42 → 43 and wrong for a state flip.
 * The preset pack ships both, so the behaviour has to be right for both: stay
 * silent during the mute, then fire once for the NET change.
 */

const state: { current: WatchState; muted: number | null; saved: WatchState | null } = {
  current: { lastValue: "socials: yes", failStreak: 0 },
  muted: null,
  saved: null,
};

vi.mock("../lib/schedules", () => ({
  getWatch: async () => ({
    owner: "wallet",
    rule: { key: "socials", op: "changed" },
    state: state.current,
    notify: { channel: "telegram", chatId: "1" },
    mutedUntil: state.muted,
  }),
  setWatchState: async (_id: string, s: WatchState) => {
    state.saved = s;
    state.current = s;
  },
}));

const { evaluateWatchForRun } = await import("../lib/watch-runner");

function check(value: string, at: number) {
  const changed = vi.fn();
  const sink = { changed, broken: vi.fn(), stalled: vi.fn() } as never;
  const run = {
    id: "r",
    skillId: "s",
    scheduleId: "sch",
    status: "completed",
    output: { socials: value },
  } as unknown as Run;
  return evaluateWatchForRun(run, sink, at).then(() => changed);
}

const HOUR = 3_600_000;

describe("a muted watch", () => {
  beforeEach(() => {
    state.current = { lastValue: "socials: yes", failStreak: 0 };
    state.muted = null;
    state.saved = null;
  });

  it("says nothing while the mute is on", async () => {
    state.muted = 10 * HOUR;
    const changed = await check("socials: gone", 1 * HOUR);
    expect(changed).not.toHaveBeenCalled();
  });

  // The finding. Without pinning the baseline this passes silently forever:
  // the value moved while nobody was listening, so by the time anyone is
  // listening again it is no longer moving.
  it("still reports the change once the mute lifts", async () => {
    state.muted = 10 * HOUR;
    await check("socials: gone", 1 * HOUR);
    // lastValue still tracks the page, so /watches stays truthful; the value
    // the quiet started at is what the lift will compare against.
    expect(state.saved?.lastValue).toBe("socials: gone");
    expect(state.saved?.mutedFrom).toBe("socials: yes");

    state.muted = null;
    const changed = await check("socials: gone", 11 * HOUR);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0]).toMatchObject({
      from: "socials: yes",
      to: "socials: gone",
    });
  });

  // The other half: quiet has to mean quiet. A value that moves ten times
  // during the mute owes exactly one message, not ten.
  it("collapses a mute full of movement into one message", async () => {
    state.muted = 10 * HOUR;
    for (let i = 1; i <= 8; i++) await check(`posts: ${i}`, i * HOUR);

    state.muted = null;
    const changed = await check("posts: 8", 11 * HOUR);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0]).toMatchObject({ from: "socials: yes", to: "posts: 8" });
  });

  // And a value that wanders and comes back owes nothing at all — there is no
  // change left to report, so reporting one would be inventing an event.
  it("says nothing when the value returns to where it started", async () => {
    state.muted = 10 * HOUR;
    await check("socials: gone", 1 * HOUR);
    await check("socials: yes", 2 * HOUR);

    state.muted = null;
    const changed = await check("socials: yes", 11 * HOUR);
    expect(changed).not.toHaveBeenCalled();
  });

  // A failed check during a mute still counts toward "this watch is broken":
  // that streak is about the watch's health, not about disturbing anyone.
  it("stops comparing across the quiet once it has reported it", async () => {
    state.muted = 10 * HOUR;
    await check("socials: gone", 1 * HOUR);
    state.muted = null;
    await check("socials: gone", 11 * HOUR); // the one catch-up message
    expect(state.saved?.mutedFrom).toBeUndefined();

    const changed = await check("socials: gone", 12 * HOUR);
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps counting failures while muted", async () => {
    state.muted = 10 * HOUR;
    const sink = { changed: vi.fn(), broken: vi.fn(), stalled: vi.fn() } as never;
    const run = { id: "r", skillId: "s", scheduleId: "sch", status: "failed" } as unknown as Run;
    await evaluateWatchForRun(run, sink, 1 * HOUR);
    expect(state.saved?.failStreak).toBe(1);
  });
});
