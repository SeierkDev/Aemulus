import { describe, expect, it } from "vitest";
import { receiptDigest, type ReceiptStep } from "../lib/receipt";

/**
 * What "verified" is allowed to mean.
 *
 * Every other field in a receipt says the published plan ran. A repaired step
 * says something different: the recorded selector failed and a model chose the
 * actions instead. While the agentic fallback was opt-in that distinction was
 * almost never live. With it on by default a real share of runs are improvised
 * somewhere, and a receipt that cannot express it is telling a verifier less
 * than they think it is.
 *
 * The constraint is that folding it in must not break a single receipt already
 * written. Those hashes are anchored on chain; changing the canonical form of
 * an old receipt does not invalidate a claim, it invalidates the proof of a
 * claim that was true.
 */

const step = (over: Partial<ReceiptStep> = {}): ReceiptStep => ({
  idx: 0,
  action: "click",
  confidence: 0.9,
  flagged: false,
  shotHash: "abc123",
  ...over,
});

const base = {
  runId: "run_1",
  skillId: "skl_1",
  owner: "w1",
  status: "completed",
};

describe("a repaired step in the receipt", () => {
  // The whole reason it is a conditional key. Every step of every receipt
  // written before repairs were recorded has repaired absent/false, so its
  // canonical form has to come out byte-identical to what it was.
  it("leaves every previously written receipt hashing exactly as before", () => {
    const before = receiptDigest({ ...base, steps: [step()] });
    const withFalse = receiptDigest({ ...base, steps: [step({ repaired: false })] });
    const withUndef = receiptDigest({ ...base, steps: [step({ repaired: undefined })] });
    expect(withFalse).toBe(before);
    expect(withUndef).toBe(before);
  });

  it("changes the hash when a step actually was repaired", () => {
    const plain = receiptDigest({ ...base, steps: [step()] });
    const fixed = receiptDigest({ ...base, steps: [step({ repaired: true })] });
    expect(fixed).not.toBe(plain);
  });

  // It has to be tamper-evident in both directions: you cannot quietly drop the
  // fact that a run was improvised, and you cannot forge it onto a clean run.
  it("cannot be added or removed without breaking the receipt", () => {
    const honest = receiptDigest({ ...base, steps: [step({ repaired: true })] });
    const scrubbed = receiptDigest({ ...base, steps: [step({ repaired: false })] });
    expect(scrubbed).not.toBe(honest);
  });

  it("is per step, not per run", () => {
    const firstFixed = receiptDigest({
      ...base,
      steps: [step({ idx: 0, repaired: true }), step({ idx: 1 })],
    });
    const secondFixed = receiptDigest({
      ...base,
      steps: [step({ idx: 0 }), step({ idx: 1, repaired: true })],
    });
    expect(firstFixed).not.toBe(secondFixed);
  });
});
