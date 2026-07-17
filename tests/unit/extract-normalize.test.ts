import { describe, it, expect } from "vitest";
import { normalizeExtracted } from "../../lib/ap-controls/extract";

describe("normalizeExtracted", () => {
  it("keeps a clean read as-is", () => {
    expect(
      normalizeExtracted({ vendor: "Acme", invoiceNumber: "INV-1", invoiceDate: "2025-04-17", amount: 1842, currency: "USD", confidence: 0.9 }),
    ).toEqual({ vendor: "Acme", invoiceNumber: "INV-1", invoiceDate: "2025-04-17", amount: 1842, currency: "USD", confidence: 0.9 });
  });

  it("clamps confidence, rounds amount, upcases currency", () => {
    const r = normalizeExtracted({ vendor: " Beta ", invoiceNumber: "", invoiceDate: "04/17/2025", amount: 12.345, currency: "usd", confidence: 5 });
    expect(r.vendor).toBe("Beta");
    expect(r.invoiceDate).toBe(""); // non-ISO date rejected
    expect(r.amount).toBe(12.35);
    expect(r.currency).toBe("USD");
    expect(r.confidence).toBe(1);
  });

  it("defaults garbage safely", () => {
    const r = normalizeExtracted({ amount: NaN, confidence: -3, currency: "" } as never);
    expect(r.amount).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.currency).toBe("USD");
    expect(r.vendor).toBe("");
  });
});
