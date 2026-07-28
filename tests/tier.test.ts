import { describe, it, expect, vi } from "vitest";
import { computeTier, limitForLevel } from "../lib/solana";

describe("limitForLevel (defaults: 5 / 50 / unlimited)", () => {
  it("maps access levels to daily run limits", () => {
    expect(limitForLevel(1)).toBe(5);
    expect(limitForLevel(2)).toBe(50);
    expect(limitForLevel(3)).toBeLessThan(0); // unlimited
    expect(limitForLevel(0)).toBe(0); // locked
  });
});

describe("computeTier with gating OFF (no mint)", () => {
  it("treats any wallet as Open / full access", () => {
    const t = computeTier(0);
    expect(t.name).toBe("Open");
    expect(t.allowed).toBe(true);
    expect(t.level).toBe(3);
  });
});

describe("computeTier with gating ON (mint set)", () => {
  it("maps balance to tiers and locks below the floor", async () => {
    vi.resetModules();
    vi.stubEnv("AEMULUS_MINT", "SoMeMintAddress1111111111111111111111111111");
    vi.stubEnv("AEMULUS_MIN_BALANCE", "1");
    vi.stubEnv("AEMULUS_PRO_BALANCE", "1000");
    vi.stubEnv("AEMULUS_WHALE_BALANCE", "100000");
    const solana = await import("../lib/solana");
    expect(solana.computeTier(0).name).toBe("Locked");
    expect(solana.computeTier(0).allowed).toBe(false);
    expect(solana.computeTier(1).name).toBe("Holder");
    expect(solana.computeTier(1000).name).toBe("Pro");
    expect(solana.computeTier(100000).name).toBe("Whale");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("a zero/negative AEMULUS_MIN_BALANCE does NOT open the gate to a zero-balance wallet", async () => {
    // Regression: minNum clamps a negative min to 0, and `balance >= 0` would then
    // admit a no-token wallet as Holder — collapsing the whole gate. A non-positive
    // balance must stay Locked regardless of a misconfigured threshold.
    for (const badMin of ["0", "-5"]) {
      vi.resetModules();
      vi.stubEnv("AEMULUS_MINT", "SoMeMintAddress1111111111111111111111111111");
      vi.stubEnv("AEMULUS_MIN_BALANCE", badMin);
      const solana = await import("../lib/solana");
      expect(solana.computeTier(0).name, `min=${badMin}, bal=0`).toBe("Locked");
      expect(solana.computeTier(0).allowed, `min=${badMin}, bal=0`).toBe(false);
      expect(solana.computeTier(5).name, `min=${badMin}, bal=5`).toBe("Holder"); // a real holding still works
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
