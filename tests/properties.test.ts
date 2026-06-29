import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildMerkle, proofForIndex, verifyProof } from "../lib/merkle";
import { receiptDigest, type ReceiptStep } from "../lib/receipt";
import { parseCsv, toCsv } from "../lib/csv";
import { limitForLevel } from "../lib/solana";
import { isUnsafeRequestUrl } from "../lib/safe-url";

/**
 * Property-style tests: instead of a handful of examples, run each invariant
 * over hundreds of generated inputs from a seeded PRNG (reproducible). Includes
 * "mutation" checks — tamper an input and assert the property now fails.
 */

// mulberry32 — deterministic PRNG so failures reproduce.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const intIn = (r: () => number, min: number, max: number) =>
  min + Math.floor(r() * (max - min + 1));

describe("merkle (property)", () => {
  it("every leaf proves to the root; a tampered leaf never does", () => {
    const r = rng(1);
    for (let trial = 0; trial < 300; trial++) {
      const n = intIn(r, 1, 40);
      const leaves = Array.from({ length: n }, () => sha(`${trial}:${r()}`));
      const tree = buildMerkle(leaves);
      const i = intIn(r, 0, n - 1);
      const proof = proofForIndex(tree, i);
      expect(verifyProof(leaves[i], proof, tree.root)).toBe(true);
      // mutation: any other leaf hash must not satisfy this slot's proof
      expect(verifyProof(sha(`evil:${r()}`), proof, tree.root)).toBe(false);
    }
  });
});

describe("receiptDigest (property)", () => {
  const actions = ["navigate", "click", "input", "select", "key", "extract"];
  it("is order-independent and changes under any step mutation", () => {
    const r = rng(2);
    for (let trial = 0; trial < 200; trial++) {
      const k = intIn(r, 1, 8);
      const steps: ReceiptStep[] = Array.from({ length: k }, (_, idx) => ({
        idx,
        action: actions[intIn(r, 0, actions.length - 1)],
        confidence: r(),
        flagged: r() < 0.5,
        shotHash: sha(`${trial}:${idx}:${r()}`),
      }));
      const id = { runId: "r", skillId: "s", owner: "o", status: "completed" };
      const base = receiptDigest({ ...id, steps });

      // shuffle → same digest (sorted by idx internally)
      const shuffled = steps
        .map((s) => ({ s, k: r() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.s);
      expect(receiptDigest({ ...id, steps: shuffled })).toBe(base);

      // mutate one screenshot hash → different digest
      const mutated = steps.map((s, j) =>
        j === intIn(r, 0, k - 1) ? { ...s, shotHash: sha(`mut:${r()}`) } : s,
      );
      // (the mutation always changes some leaf, so the digest must differ)
      const same = mutated.every((s, j) => s.shotHash === steps[j].shotHash);
      if (!same) expect(receiptDigest({ ...id, steps: mutated })).not.toBe(base);
    }
  });
});

describe("csv (property)", () => {
  const headers = ["a", "b", "c"];
  const cell = (r: () => number) => {
    const bits = ["x", ",", '"', "\n", " z", "ok", "1,2"];
    let s = "v";
    for (let i = 0; i < intIn(r, 0, 3); i++) s += bits[intIn(r, 0, bits.length - 1)];
    return s;
  };
  it("toCsv → parseCsv round-trips arbitrary cells", () => {
    const r = rng(3);
    for (let trial = 0; trial < 200; trial++) {
      const rows = Array.from({ length: intIn(r, 1, 5) }, () => ({
        a: cell(r),
        b: cell(r),
        c: cell(r),
      }));
      const grid = parseCsv(toCsv(headers, rows));
      expect(grid[0]).toEqual(headers);
      expect(grid.slice(1)).toEqual(rows.map((x) => [x.a, x.b, x.c]));
    }
  });
});

describe("quota tiers (property)", () => {
  it("limitForLevel is ordered; whale is unlimited", () => {
    expect(limitForLevel(0)).toBe(0);
    expect(limitForLevel(1)).toBeGreaterThan(0);
    expect(limitForLevel(1)).toBeLessThan(limitForLevel(2));
    expect(limitForLevel(3)).toBeLessThan(0); // unlimited by default
  });
});

describe("egress filter (property)", () => {
  it("blocks generated private IPs, allows public ones", () => {
    const r = rng(4);
    for (let trial = 0; trial < 200; trial++) {
      const privates = [
        `10.${intIn(r, 0, 255)}.${intIn(r, 0, 255)}.${intIn(r, 0, 255)}`,
        `192.168.${intIn(r, 0, 255)}.${intIn(r, 0, 255)}`,
        `172.${intIn(r, 16, 31)}.${intIn(r, 0, 255)}.1`,
        `127.0.0.${intIn(r, 1, 255)}`,
        `169.254.${intIn(r, 0, 255)}.${intIn(r, 0, 255)}`,
      ];
      for (const ip of privates) {
        expect(isUnsafeRequestUrl(`http://${ip}/x`)).toBe(true);
      }
      // public: first octet 1..9 (outside private ranges)
      const pub = `${intIn(r, 1, 9)}.${intIn(r, 0, 255)}.${intIn(r, 0, 255)}.${intIn(r, 1, 254)}`;
      expect(isUnsafeRequestUrl(`https://${pub}/x`)).toBe(false);
    }
  });
});
