import { beforeAll, describe, expect, it } from "vitest";

/**
 * computeTier's gated path is invisible in the rest of the suite (mint unset →
 * gating off → everyone "Open"). Here we set the mint + thresholds BEFORE
 * importing lib/solana (dynamic import) so we exercise the real tier ladder.
 */
type Solana = typeof import("../lib/solana");
let s: Solana;

beforeAll(async () => {
  process.env.AEMULUS_MINT = "So11111111111111111111111111111111111111112";
  process.env.AEMULUS_MIN_BALANCE = "1";
  process.env.AEMULUS_PRO_BALANCE = "1000";
  process.env.AEMULUS_WHALE_BALANCE = "100000";
  s = await import("../lib/solana");
});

describe("computeTier (gating on)", () => {
  it("gatingEnabled() is true when a mint is set", () => {
    expect(s.gatingEnabled()).toBe(true);
    expect(s.tokenLaunched()).toBe(true);
  });

  it("maps balances to the right tier + level", () => {
    expect(s.computeTier(0)).toMatchObject({ name: "Locked", level: 0, allowed: false });
    expect(s.computeTier(1)).toMatchObject({ name: "Holder", level: 1, allowed: true });
    expect(s.computeTier(999)).toMatchObject({ name: "Holder", level: 1 });
    expect(s.computeTier(1000)).toMatchObject({ name: "Pro", level: 2, allowed: true });
    expect(s.computeTier(100000)).toMatchObject({ name: "Whale", level: 3, allowed: true });
  });

  it("limitForLevel: locked 0, holder/pro finite + ordered, whale unlimited", () => {
    expect(s.limitForLevel(0)).toBe(0);
    expect(s.limitForLevel(1)).toBeGreaterThan(0);
    expect(s.limitForLevel(1)).toBeLessThan(s.limitForLevel(2));
    expect(s.limitForLevel(3)).toBeLessThan(0);
  });
});
