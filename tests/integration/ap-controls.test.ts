import { describe, it, expect } from "vitest";
import { SMALL_FIRM, LARGE_TEAM, canSee } from "../../lib/ap-controls/schema";
import {
  evaluateAutoSubmit,
  evaluateOverride,
  REQUIRED_FIELDS,
  type InvoiceFacts,
  type ExtractedField,
} from "../../lib/ap-controls/evaluate";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function facts(over: Partial<InvoiceFacts> = {}): InvoiceFacts {
  return {
    total: 500, currency: "USD", invoiceDate: NOW - 5 * DAY, vendorStatus: "matched",
    duplicateOf: null, totalsReconciled: true, totalsDiscrepancy: 0,
    glAccount: "6000 Office", glSensitive: false, usedFallbackOnCritical: false,
    outcomeConfirmed: true, ...over,
  };
}
function fields(over: Partial<Record<string, number>> = {}): ExtractedField[] {
  return REQUIRED_FIELDS.map((f) => ({
    field: f, value: f === "total" ? 500 : "x", confidence: over[f] ?? 0.99,
  }));
}
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe("evaluateAutoSubmit", () => {
  it("allows a clean, confident, matched, in-limit invoice", () => {
    const r = evaluateAutoSubmit({ facts: facts(), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(r.decision).toBe("allow");
    expect(r.reasons).toHaveLength(0);
  });

  it("holds a new-vendor invoice for review", () => {
    const r = evaluateAutoSubmit({ facts: facts({ vendorStatus: "unknown" }), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(r.decision).toBe("needs_review");
    expect(codes(r)).toContain("NEW_VENDOR");
  });

  it("holds a foreign-currency invoice", () => {
    const r = evaluateAutoSubmit({ facts: facts({ currency: "EUR" }), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(codes(r)).toContain("FOREIGN_CURRENCY");
  });

  it("holds a totals discrepancy", () => {
    const r = evaluateAutoSubmit({ facts: facts({ totalsReconciled: false, totalsDiscrepancy: 3 }), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(codes(r)).toContain("TOTALS_MISMATCH");
  });

  it("holds an amount over the ceiling (small firm: $1,000)", () => {
    const r = evaluateAutoSubmit({ facts: facts({ total: 2_000 }), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(codes(r)).toContain("OVER_CEILING");
    // $2,000 is fine under the larger team's $5,000 ceiling
    const big = evaluateAutoSubmit({ facts: facts({ total: 2_000 }), fields: fields(), config: LARGE_TEAM, now: NOW });
    expect(codes(big)).not.toContain("OVER_CEILING");
  });

  it("holds a suspected duplicate and a low-confidence field and a sensitive-but-undetermined GL", () => {
    const dup = evaluateAutoSubmit({ facts: facts({ duplicateOf: "bill_1043" }), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(codes(dup)).toContain("DUPLICATE");
    const low = evaluateAutoSubmit({ facts: facts(), fields: fields({ tax: 0.4 }), config: SMALL_FIRM, now: NOW });
    expect(codes(low)).toContain("LOW_CONFIDENCE");
    const gl = evaluateAutoSubmit({ facts: facts({ glAccount: null }), fields: fields(), config: SMALL_FIRM, now: NOW });
    expect(codes(gl)).toContain("GL_UNDETERMINED");
  });
});

const clerk = { userId: "u_clerk", role: "clerk" as const };
const clerk2 = { userId: "u_clerk2", role: "clerk" as const };
const controller = { userId: "u_ctrl", role: "controller" as const };
const controller2 = { userId: "u_ctrl2", role: "controller" as const };
const approver = { userId: "u_appr", role: "approver" as const };

const ofacts = (o: Partial<{ total: number; currency: string; totalsDiscrepancy: number; glSensitive: boolean }> = {}) => ({
  total: 500, currency: "USD", totalsDiscrepancy: 0, glSensitive: false, ...o,
});

describe("evaluateOverride — small firm", () => {
  it("allows a clerk's duplicate override under the second-approval trigger", () => {
    const r = evaluateOverride({ type: "duplicate", facts: ofacts({ total: 500 }), actor: clerk, preparerId: "u_clerk", reason: "legit re-bill", config: SMALL_FIRM });
    expect(r.decision).toBe("allow");
  });

  it("requires a second approver for a duplicate override over $1,000", () => {
    const r = evaluateOverride({ type: "duplicate", facts: ofacts({ total: 2_000 }), actor: clerk, preparerId: "u_prep", reason: "legit re-bill", config: SMALL_FIRM });
    expect(r.decision).toBe("require_second");
    expect(r.triggeredRuleIds).toContain("OVERRIDE.SECOND");
  });

  it("allows the over-$1,000 duplicate override with a valid distinct second approver", () => {
    const r = evaluateOverride({ type: "duplicate", facts: ofacts({ total: 2_000 }), actor: clerk, preparerId: "u_prep", secondApprover: controller, reason: "legit re-bill", config: SMALL_FIRM });
    expect(r.decision).toBe("allow");
  });

  it("blocks a currency override the clerk isn't permitted to do", () => {
    const r = evaluateOverride({ type: "currency", facts: ofacts({ currency: "EUR" }), actor: clerk, preparerId: "u_prep", reason: "eur invoice", config: SMALL_FIRM });
    expect(r.decision).toBe("block");
    expect(codes(r)).toContain("NOT_PERMITTED");
  });

  it("requires a second approver (always) for a controller's currency override, then allows with one", () => {
    const first = evaluateOverride({ type: "currency", facts: ofacts({ currency: "EUR" }), actor: controller, preparerId: "u_prep", reason: "eur invoice", config: SMALL_FIRM });
    expect(first.decision).toBe("require_second");
    const ok = evaluateOverride({ type: "currency", facts: ofacts({ currency: "EUR" }), actor: controller, preparerId: "u_prep", secondApprover: controller2, reason: "eur invoice", config: SMALL_FIRM });
    expect(ok.decision).toBe("allow");
  });

  it("hard-blocks a totals override beyond the hard limit", () => {
    const r = evaluateOverride({ type: "totals", facts: ofacts({ total: 1_000, totalsDiscrepancy: 300 }), actor: clerk, preparerId: "u_prep", reason: "rounding", config: SMALL_FIRM });
    expect(r.decision).toBe("block");
    expect(codes(r)).toContain("TOTALS_HARD_LIMIT");
  });

  it("hard-caps a clerk's amount override over $25,000 but lets a controller proceed with a second approver", () => {
    const blocked = evaluateOverride({ type: "amount", facts: ofacts({ total: 30_000 }), actor: clerk, preparerId: "u_prep", reason: "correction", config: SMALL_FIRM });
    expect(blocked.decision).toBe("block");
    expect(codes(blocked)).toContain("HARD_CAP");

    const needsSecond = evaluateOverride({ type: "amount", facts: ofacts({ total: 30_000 }), actor: controller, preparerId: "u_prep", reason: "correction", config: SMALL_FIRM });
    expect(needsSecond.decision).toBe("require_second");

    const ok = evaluateOverride({ type: "amount", facts: ofacts({ total: 30_000 }), actor: controller, preparerId: "u_prep", secondApprover: controller2, reason: "correction", config: SMALL_FIRM });
    expect(ok.decision).toBe("allow");
  });

  it("requires a second approver for a sensitive-GL override", () => {
    const r = evaluateOverride({ type: "gl", facts: ofacts({ glSensitive: true }), actor: clerk, preparerId: "u_prep", config: SMALL_FIRM });
    expect(r.decision).toBe("require_second");
  });
});

describe("evaluateOverride — maker-checker enforcement", () => {
  it("blocks when the second approver prepared the invoice", () => {
    const r = evaluateOverride({ type: "duplicate", facts: ofacts({ total: 2_000 }), actor: clerk, preparerId: "u_ctrl", secondApprover: controller, reason: "x", config: SMALL_FIRM });
    expect(r.decision).toBe("block");
    expect(codes(r)).toContain("MAKER_CHECKER_VIOLATION");
  });

  it("blocks when the actor tries to be their own second approver", () => {
    const r = evaluateOverride({ type: "currency", facts: ofacts({ currency: "EUR" }), actor: controller, preparerId: "u_prep", secondApprover: controller, reason: "x", config: SMALL_FIRM });
    expect(r.decision).toBe("block");
    expect(codes(r)).toContain("MAKER_CHECKER_VIOLATION");
  });

  it("blocks a second approver who lacks approve.second (another clerk)", () => {
    const r = evaluateOverride({ type: "duplicate", facts: ofacts({ total: 2_000 }), actor: clerk, preparerId: "u_prep", secondApprover: clerk2, reason: "x", config: SMALL_FIRM });
    expect(r.decision).toBe("block");
    expect(codes(r)).toContain("SECOND_APPROVER_NOT_AUTHORIZED");
  });
});

describe("evaluateOverride — larger team", () => {
  it("requires a second approver for an approver's foreign-currency override, then allows with a controller", () => {
    const first = evaluateOverride({ type: "currency", facts: ofacts({ currency: "EUR", total: 8_000 }), actor: approver, preparerId: "u_prep", reason: "eur", config: LARGE_TEAM });
    expect(first.decision).toBe("require_second");
    const ok = evaluateOverride({ type: "currency", facts: ofacts({ currency: "EUR", total: 8_000 }), actor: approver, preparerId: "u_prep", secondApprover: controller, reason: "eur", config: LARGE_TEAM });
    expect(ok.decision).toBe("allow");
  });

  it("hard-caps an approver's amount override over $100,000; a controller proceeds with a second", () => {
    const blocked = evaluateOverride({ type: "amount", facts: ofacts({ total: 120_000 }), actor: approver, preparerId: "u_prep", reason: "fix", config: LARGE_TEAM });
    expect(blocked.decision).toBe("block");
    expect(codes(blocked)).toContain("HARD_CAP");
    const ctrl = evaluateOverride({ type: "amount", facts: ofacts({ total: 120_000 }), actor: controller, preparerId: "u_prep", secondApprover: approver, reason: "fix", config: LARGE_TEAM });
    expect(ctrl.decision).toBe("allow");
  });

  it("blocks any override attempted by an auditor (read-only)", () => {
    const r = evaluateOverride({ type: "duplicate", facts: ofacts({ total: 100 }), actor: { userId: "u_aud", role: "auditor" }, preparerId: "u_prep", reason: "x", config: LARGE_TEAM });
    expect(r.decision).toBe("block");
    expect(codes(r)).toContain("NOT_PERMITTED");
  });

  it("requires a reason for a sensitive-GL override (reasonRequired=true), and requires a second once given", () => {
    const noReason = evaluateOverride({ type: "gl", facts: ofacts({ glSensitive: true }), actor: clerk, preparerId: "u_prep", config: LARGE_TEAM });
    expect(noReason.decision).toBe("block");
    expect(codes(noReason)).toContain("REASON_REQUIRED");
    const withReason = evaluateOverride({ type: "gl", facts: ofacts({ glSensitive: true }), actor: clerk, preparerId: "u_prep", reason: "capex", config: LARGE_TEAM });
    expect(withReason.decision).toBe("require_second");
  });
});

describe("UI visibility per role", () => {
  it("shows the controller config + vendor bank; hides them from a clerk; auditor is read-only", () => {
    expect(canSee(SMALL_FIRM, "controller", "config.thresholds")).toBe(true);
    expect(canSee(SMALL_FIRM, "clerk", "config.thresholds")).toBe(false);
    expect(canSee(SMALL_FIRM, "clerk", "override.currency")).toBe(false);
    expect(canSee(SMALL_FIRM, "clerk", "override.amount")).toBe(true);
    expect(canSee(LARGE_TEAM, "auditor", "audit.export")).toBe(true);
    expect(canSee(LARGE_TEAM, "auditor", "invoice.submit")).toBe(false);
    expect(canSee(LARGE_TEAM, "approver", "vendor.approve")).toBe(true);
    expect(canSee(LARGE_TEAM, "approver", "vendor.bankEdit")).toBe(false);
  });
});
