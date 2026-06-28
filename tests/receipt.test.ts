import { describe, it, expect } from "vitest";
import { receiptDigest, type ReceiptStep } from "../lib/receipt";

const steps: ReceiptStep[] = [
  { idx: 0, action: "navigate", confidence: 0.99, flagged: false, shotHash: "aaa" },
  { idx: 1, action: "input", confidence: 0.99, flagged: false, shotHash: "bbb" },
];
const base = { runId: "run_1", skillId: "skl_1", owner: "W", status: "completed", steps };

describe("receiptDigest", () => {
  it("is deterministic and step-order independent", () => {
    const h1 = receiptDigest(base);
    const h2 = receiptDigest({ ...base, steps: [steps[1], steps[0]] });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes if a screenshot hash changes (tamper-evident)", () => {
    const tampered = {
      ...base,
      steps: [steps[0], { ...steps[1], shotHash: "ccc" }],
    };
    expect(receiptDigest(tampered)).not.toBe(receiptDigest(base));
  });

  it("changes if the run status changes", () => {
    expect(receiptDigest({ ...base, status: "failed" })).not.toBe(
      receiptDigest(base),
    );
  });
});
