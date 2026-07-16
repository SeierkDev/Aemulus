import { describe, it, expect } from "vitest";
import { SMALL_FIRM } from "../../lib/ap-controls/schema";
import type { EvalResult, Actor } from "../../lib/ap-controls/evaluate";
import type { EvidenceView } from "../../lib/ap-controls/schema";
import {
  writeOverrideEvent,
  verifyOverrideChain,
  OverrideWriteError,
  type OverrideLogInput,
} from "../../lib/ap-controls/override-log";

const NOW = 1_700_000_000_000;
const ALLOW: EvalResult = { decision: "allow", reasons: [], triggeredRuleIds: [], banner: "" };
const REQUIRE_SECOND: EvalResult = { decision: "require_second", reasons: [{ code: "SECOND_REQUIRED" }], triggeredRuleIds: ["OVERRIDE.SECOND"], banner: "" };
const BLOCK: EvalResult = { decision: "block", reasons: [{ code: "HARD_CAP" }], triggeredRuleIds: ["OVERRIDE.HARDCAP"], banner: "" };

const clerk: Actor = { userId: "u_clerk", role: "clerk" };
const clerk2: Actor = { userId: "u_clerk2", role: "clerk" };
const controller: Actor = { userId: "u_ctrl", role: "controller" };

const fullEvidence: EvidenceView[] = [
  { artifact: "sourceInvoice", at: NOW },
  { artifact: "replay", at: NOW, watchedMs: 3_000 },
];

function base(over: Partial<OverrideLogInput> = {}): OverrideLogInput {
  return {
    priorSeal: "genesis",
    invoiceId: "inv_1",
    entryRecordId: "er_1",
    decision: ALLOW,
    type: "amount",
    field: "total",
    originalValue: 100,
    newValue: 120,
    reason: { code: "CORRECTION", note: "keyed the wrong cents" },
    actor: clerk,
    preparerId: "u_prep",
    evidenceViewed: fullEvidence,
    config: SMALL_FIRM,
    now: NOW,
    id: "ev_1",
    ...over,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

describe("writeOverrideEvent — well-formed output", () => {
  it("seals a valid override and preserves the original value", () => {
    const e = writeOverrideEvent(base());
    expect(e.seal).toMatch(HEX64);
    expect(e.sealPrev).toBe("genesis");
    expect(e.originalValue).toBe(100);
    expect(e.newValue).toBe(120);
    expect(e.reasonCode).toBe("CORRECTION");
    expect(e.actor).toEqual({ userId: "u_clerk", role: "clerk", at: NOW });
  });

  it("is deterministic — identical inputs produce an identical seal", () => {
    expect(writeOverrideEvent(base()).seal).toBe(writeOverrideEvent(base()).seal);
  });

  it("records a satisfied require_second with the second approver", () => {
    const e = writeOverrideEvent(base({ decision: REQUIRE_SECOND, secondApprover: controller }));
    expect(e.seal).toMatch(HEX64);
    expect(e.secondApprover).toEqual({ userId: "u_ctrl", role: "controller", at: NOW });
  });
});

describe("tamper-chain continuity", () => {
  it("links a two-event chain back to genesis and detects tampering", () => {
    const e1 = writeOverrideEvent(base({ id: "ev_1", priorSeal: "genesis" }));
    const e2 = writeOverrideEvent(base({ id: "ev_2", priorSeal: e1.seal, field: "vendorId", originalValue: "v1", newValue: "v2" }));

    expect(e2.sealPrev).toBe(e1.seal);
    expect(verifyOverrideChain("genesis", [e1, e2])).toEqual({ valid: true });

    // Tamper with the first event's value → its seal no longer recomputes.
    const tampered = { ...e1, newValue: 999 };
    expect(verifyOverrideChain("genesis", [tampered, e2])).toEqual({ valid: false, brokenAt: 0 });

    // Break the link between e1 and e2.
    const relinked = { ...e2, sealPrev: "wrong" };
    expect(verifyOverrideChain("genesis", [e1, relinked])).toEqual({ valid: false, brokenAt: 1 });
  });

  it("never mutates prior events when appending", () => {
    const e1 = writeOverrideEvent(base({ id: "ev_1" }));
    const snapshot = structuredClone(e1);
    writeOverrideEvent(base({ id: "ev_2", priorSeal: e1.seal }));
    expect(e1).toEqual(snapshot);
  });
});

describe("write rejections", () => {
  it("rejects a missing reason", () => {
    expect(() => writeOverrideEvent(base({ reason: { code: "  " } }))).toThrow(OverrideWriteError);
    try {
      writeOverrideEvent(base({ reason: { code: "" } }));
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("REASON_REQUIRED");
    }
  });

  it("rejects when the replay was not viewed", () => {
    try {
      writeOverrideEvent(base({ evidenceViewed: [{ artifact: "sourceInvoice", at: NOW }] }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("EVIDENCE_REQUIRED");
    }
  });

  it("rejects when the source invoice was not viewed", () => {
    try {
      writeOverrideEvent(base({ evidenceViewed: [{ artifact: "replay", at: NOW }] }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("EVIDENCE_REQUIRED");
    }
  });

  it("rejects a block/needs_review decision", () => {
    try {
      writeOverrideEvent(base({ decision: BLOCK }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("NOT_AUTHORIZED");
    }
  });

  it("rejects require_second with no second approver", () => {
    try {
      writeOverrideEvent(base({ decision: REQUIRE_SECOND }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("SECOND_APPROVER_REQUIRED");
    }
  });

  it("rejects an invalid second approver (maker-checker: same as preparer)", () => {
    try {
      writeOverrideEvent(base({ decision: REQUIRE_SECOND, preparerId: "u_ctrl", secondApprover: controller }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("INVALID_SECOND_APPROVER");
    }
  });

  it("rejects a second approver who lacks approve.second", () => {
    try {
      writeOverrideEvent(base({ decision: REQUIRE_SECOND, secondApprover: clerk2 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OverrideWriteError).code).toBe("INVALID_SECOND_APPROVER");
    }
  });
});
