import { describe, it, expect } from "vitest";
import { id } from "../lib/ids";

describe("id", () => {
  it("is prefixed and url-safe", () => {
    expect(id("dem")).toMatch(/^dem_[a-f0-9]{12}$/);
  });
  it("is unique across calls", () => {
    const set = new Set(Array.from({ length: 500 }, () => id("run")));
    expect(set.size).toBe(500);
  });
});
