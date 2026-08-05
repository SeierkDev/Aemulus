import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A field element has a width, and bigint.toString(16) does not respect it.
 *
 * Found on a live run: constraintHash came back 63 characters —
 * d13bca3195203bbab241d48644f8ab9812c76972e0dfae43acdf6a7e3984cff — because its
 * top nibble was zero and toString(16) dropped it. That happens to roughly one
 * hash in sixteen.
 *
 * It matters because the entire argument for using AgenC's canonical hashing,
 * rather than inventing our own, is that a third party can recompute the number
 * with their SDK and compare it to ours. They will render a field element at
 * full width. An unpadded string then fails a comparison that should have
 * succeeded, and the interop claim quietly stops being true for one run in
 * sixteen — while every internal check keeps passing, because we were comparing
 * our own unpadded value against itself.
 */
describe("field elements are fixed width", () => {
  const src = readFileSync("lib/agenc.ts", "utf8");

  it("pads every emitted field element", () => {
    expect(src).toMatch(/padStart\(64, "0"\)/);
    // No raw toString(16) left on a field element.
    expect(src).not.toMatch(/computeConstraintHash\([^)]*\)\.toString\(16\)/);
    expect(src).not.toMatch(/outputCommitment\.toString\(16\)/);
    expect(src).not.toMatch(/salt\.toString\(16\)/);
  });

  // Runs written before the fix hold an unpadded hash. Re-padding only what we
  // compute would break their verification — the value was right, its width was
  // not — so the comparison pads both sides.
  it("still verifies a run whose stored hash was written unpadded", () => {
    expect(src).toMatch(/expected\.padStart\(64, "0"\)/);
  });

  it("pads rather than truncates", () => {
    // BigInt() rather than an 0n literal: the test tsconfig targets below
    // ES2020, where the literal form does not compile.
    const n = BigInt("0x0d13bca");
    const short = n.toString(16);
    expect(short.padStart(64, "0")).toHaveLength(64);
    expect(BigInt("0x" + short.padStart(64, "0"))).toBe(n);
  });
});
