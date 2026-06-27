import { describe, it, expect } from "vitest";
import { rateLimit } from "../lib/ratelimit";

describe("rateLimit (sliding window)", () => {
  it("allows up to max then blocks within the window", () => {
    const k = `k-${Math.random()}`;
    const t = 1_000_000;
    expect(rateLimit(k, 2, 1000, t).ok).toBe(true);
    expect(rateLimit(k, 2, 1000, t + 10).ok).toBe(true);
    const third = rateLimit(k, 2, 1000, t + 20);
    expect(third.ok).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("recovers after the window passes", () => {
    const k = `k-${Math.random()}`;
    const t = 2_000_000;
    rateLimit(k, 1, 1000, t);
    expect(rateLimit(k, 1, 1000, t + 500).ok).toBe(false);
    expect(rateLimit(k, 1, 1000, t + 1500).ok).toBe(true);
  });
});
