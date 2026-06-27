import { describe, it, expect } from "vitest";
import { encryptJSON, decryptJSON } from "../lib/encrypt";

describe("at-rest encryption", () => {
  it("round-trips a value and hides the plaintext", () => {
    const value = { vendor: "Acme Corp", amount: "129.00" };
    const enc = encryptJSON(value);
    expect(enc.startsWith("enc1:")).toBe(true);
    expect(enc).not.toContain("Acme");
    expect(decryptJSON(enc, null)).toEqual(value);
  });

  it("tolerates legacy plaintext JSON", () => {
    expect(decryptJSON('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("falls back on garbage", () => {
    expect(decryptJSON("enc1:not-valid", "fallback")).toBe("fallback");
    expect(decryptJSON(null, [])).toEqual([]);
  });
});
