import { describe, expect, it } from "vitest";
import { estimateRunCostUsd, formatUsd } from "../lib/cost";

describe("run cost estimate", () => {
  it("prices operator tokens at the default $3/$15 per 1M", () => {
    // 1M in + 1M out = $3 + $15 = $18
    expect(estimateRunCostUsd(1_000_000, 1_000_000)).toBeCloseTo(18, 5);
    expect(estimateRunCostUsd(0, 0)).toBe(0);
  });

  it("formats small/zero amounts readably", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(estimateRunCostUsd(100, 50))).toBe("<$0.01");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
