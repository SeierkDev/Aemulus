import { beforeAll, describe, it, expect } from "vitest";
import { ready } from "../../lib/db";
import { appendApEvent, type ApEventRow, type ApEventType, type ApAggregateType } from "../../lib/ap-controls/store";
import {
  foldInvoiceEntryState,
  foldVendorMasterState,
  buildInvoiceQueue,
  projectInvoiceEntry,
  projectVendorMaster,
  projectInvoiceQueue,
} from "../../lib/ap-controls/projections";

const NOW = 1_700_000_000_000;
const actor = { userId: "u_clerk", role: "clerk" };
let n = 0;
const uid = (p: string) => `${p}_${++n}_proj`;

// Hand-built rows for PURE fold tests (fold reads seq/createdAt/seal/type/payload).
function row(
  aggregateId: string,
  seq: number,
  eventType: ApEventType,
  payload: Record<string, unknown>,
  aggregateType: ApAggregateType = "invoice",
): ApEventRow {
  return {
    id: `${aggregateId}-${seq}`, workspaceId: "default", aggregateType, aggregateId, seq, eventType,
    eventVersion: 1, payload, actor, createdAt: NOW + seq * 1_000,
    sealPrev: seq === 0 ? "genesis" : `s${seq - 1}`, seal: `s${seq}`,
  };
}

describe("foldInvoiceEntryState (pure)", () => {
  it("returns an empty 'new' state from genesis (no events)", () => {
    expect(foldInvoiceEntryState([])).toMatchObject({ invoiceId: "", status: "new", amount: null, lastSeq: -1 });
  });

  it("is deterministic — same events fold to deeply-equal state", () => {
    const evs = [row("inv_a", 0, "invoice.review_paused", { reasonCodes: ["DUPLICATE"], topReasonCode: "DUPLICATE", banner: "", amount: 500, currency: "USD", vendor: "Acme", requiresSecondApproval: false })];
    expect(foldInvoiceEntryState(evs)).toEqual(foldInvoiceEntryState(evs));
  });

  it("folds pause → override → submit into a submitted state with updated amount", () => {
    const s = foldInvoiceEntryState([
      row("inv_a", 0, "invoice.review_paused", { reasonCodes: ["OVER_CEILING", "NEW_VENDOR"], topReasonCode: "OVER_CEILING", banner: "held", amount: 2_000, currency: "USD", vendor: "Acme", requiresSecondApproval: true }),
      row("inv_a", 1, "invoice.override", { type: "amount", field: "total", originalValue: 2_000, newValue: 1_800, reasonCode: "CORR" }),
      row("inv_a", 2, "invoice.submitted", { billNumber: "B-9", total: 1_800, currency: "USD", auto: false }),
    ]);
    expect(s).toMatchObject({
      status: "submitted", amount: 1_800, billNumber: "B-9", submittedAuto: false,
      pendingSecondApproval: false, lastSeq: 2, latestSeal: "s2",
    });
    expect(s.overrides).toHaveLength(1);
    expect(s.overrides[0]).toMatchObject({ field: "total", from: 2_000, to: 1_800 });
  });

  it("keeps a paused, not-yet-submitted invoice actionable with its top reason and vendor", () => {
    const s = foldInvoiceEntryState([
      row("inv_b", 0, "invoice.review_paused", { reasonCodes: ["NEW_VENDOR"], topReasonCode: "NEW_VENDOR", banner: "", amount: 750, currency: "USD", vendor: "NewCo", requiresSecondApproval: true }),
    ]);
    expect(s).toMatchObject({ status: "needs_review", topReasonCode: "NEW_VENDOR", amount: 750, vendor: "NewCo", pendingSecondApproval: true, enteredReviewAt: NOW });
  });
});

describe("foldVendorMasterState (pure)", () => {
  it("folds requested → approved → bank_verified", () => {
    const s = foldVendorMasterState([
      row("v_1", 0, "vendor.requested", { name: "Acme", hasBankDetails: true }, "vendor"),
      row("v_1", 1, "vendor.approved", { firstInvoiceReview: true }, "vendor"),
      row("v_1", 2, "vendor.bank_verified", { method: "callback", verifiedBy: "u_ctrl" }, "vendor"),
    ]);
    expect(s).toMatchObject({ vendorId: "v_1", status: "approved", name: "Acme", hasBankDetails: true, bankVerified: true, firstInvoiceReview: true });
    expect(s.bankVerification).toMatchObject({ method: "callback", verifiedBy: "u_ctrl" });
  });

  it("returns 'none' from genesis", () => {
    expect(foldVendorMasterState([])).toMatchObject({ status: "none", bankVerified: false });
  });
});

describe("buildInvoiceQueue (pure)", () => {
  it("includes only actionable invoices, escalations first then oldest", () => {
    const escalated = foldInvoiceEntryState([row("inv_esc", 0, "invoice.review_paused", { reasonCodes: ["OVER_CEILING"], topReasonCode: "OVER_CEILING", banner: "", amount: 9_000, currency: "USD", vendor: "Big", requiresSecondApproval: true })]);
    const older = foldInvoiceEntryState([{ ...row("inv_old", 0, "invoice.review_paused", { reasonCodes: ["DUPLICATE"], topReasonCode: "DUPLICATE", banner: "", amount: 100, currency: "USD", vendor: "V", requiresSecondApproval: false }), createdAt: NOW - 100_000 }]);
    const done = foldInvoiceEntryState([row("inv_done", 0, "invoice.submitted", { billNumber: "B", total: 1, currency: "USD", auto: true })]);

    const q = buildInvoiceQueue([older, escalated, done], NOW + 10_000);
    expect(q).toHaveLength(2); // submitted excluded
    expect(q[0].invoiceId).toBe("inv_esc"); // escalation first
    expect(q[0].pendingSecondApproval).toBe(true);
    expect(q[1].invoiceId).toBe("inv_old");
    expect(q[0]).toMatchObject({ topReason: "OVER_CEILING", amount: 9_000, vendor: "Big" });
  });
});

describe("live projections (store → upcast → fold)", () => {
  beforeAll(async () => {
    await ready();
  });

  it("upcasts a v1 invoice.submitted (amount → total) when projecting", async () => {
    const id = uid("inv");
    await appendApEvent({ aggregateType: "invoice", aggregateId: id, eventType: "invoice.submitted", eventVersion: 1, payload: { billNumber: "B-old", amount: 500, currency: "USD", auto: true }, actor, now: NOW, id: `e_${id}` });
    const s = await projectInvoiceEntry(id);
    expect(s.status).toBe("submitted");
    expect(s.amount).toBe(500); // came through the v1→v2 upcaster
    expect(s.submittedAuto).toBe(true);
  });

  it("handles duplicate overrides and surfaces the invoice in the queue", async () => {
    const id = uid("inv");
    await appendApEvent({ aggregateType: "invoice", aggregateId: id, eventType: "invoice.review_paused", payload: { reasonCodes: ["DUPLICATE"], topReasonCode: "DUPLICATE", banner: "possible duplicate", amount: 2_000, currency: "USD", vendor: "Acme", requiresSecondApproval: true }, actor, now: NOW, id: `e1_${id}` });
    await appendApEvent({ aggregateType: "invoice", aggregateId: id, eventType: "invoice.override", payload: { type: "duplicate", field: "duplicate", originalValue: true, newValue: false, reasonCode: "LEGIT_REBILL" }, actor, now: NOW + 1_000, id: `e2_${id}` });
    await appendApEvent({ aggregateType: "invoice", aggregateId: id, eventType: "invoice.override", payload: { type: "duplicate", field: "duplicate", originalValue: true, newValue: false, reasonCode: "LEGIT_REBILL_2" }, actor, now: NOW + 2_000, id: `e3_${id}` });

    const s = await projectInvoiceEntry(id);
    expect(s.status).toBe("needs_review");
    expect(s.overrides).toHaveLength(2);
    expect(s.pendingSecondApproval).toBe(false); // cleared by the logged (approved) overrides

    const q = await projectInvoiceQueue([id], NOW + 5_000);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ invoiceId: id, topReason: "DUPLICATE", amount: 2_000, vendor: "Acme" });
    expect(q[0].ageMs).toBe(5_000);
  });

  it("projects the vendor approval + bank-verification path", async () => {
    const id = uid("vend");
    await appendApEvent({ aggregateType: "vendor", aggregateId: id, eventType: "vendor.requested", payload: { name: "Globex", hasBankDetails: true }, actor, now: NOW, id: `e1_${id}` });
    await appendApEvent({ aggregateType: "vendor", aggregateId: id, eventType: "vendor.approved", payload: { firstInvoiceReview: true }, actor, now: NOW + 1_000, id: `e2_${id}` });
    await appendApEvent({ aggregateType: "vendor", aggregateId: id, eventType: "vendor.bank_verified", payload: { method: "callback", verifiedBy: "u_ctrl" }, actor, now: NOW + 2_000, id: `e3_${id}` });

    const vs = await projectVendorMaster(id);
    expect(vs).toMatchObject({ status: "approved", name: "Globex", bankVerified: true, firstInvoiceReview: true });
    expect(vs.bankVerification).toMatchObject({ method: "callback", verifiedBy: "u_ctrl" });
  });
});
