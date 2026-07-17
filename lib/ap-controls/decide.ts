import { id as newId } from "../ids";
import { appendApEvent, verifyAggregate } from "./store";
import { projectInvoiceEntry } from "./projections";
import { enterInvoice } from "./qbo-submit";

// Core of a generic invoice decision (approve → sealed override + enter; reject →
// sealed rejection). Pure of HTTP/auth so it's unit-testable; the route wraps it
// with authentication, the demo-invoice guard, and entitlement.

export interface DecideInput {
  invoiceId: string;
  workspaceId: string;
  actor: { userId: string; role: "clerk" };
  action: "approve" | "reject";
  reasonCode: string;
  note?: string;
  /** Entitlement decision for the caller (false → over plan/tier limit). */
  canEnter: boolean;
  now: number;
}

export type DecideResult =
  | { ok: true; status: "rejected" }
  | { ok: true; status: "submitted"; billNumber: string; target: string; verify: { valid: boolean; length: number }; seal: string }
  | { ok: false; error: string; httpStatus: number };

export async function decideInvoice(input: DecideInput): Promise<DecideResult> {
  const { invoiceId, workspaceId, actor, action, reasonCode, note, now } = input;

  const state = await projectInvoiceEntry(invoiceId, workspaceId);
  if (state.status !== "needs_review") {
    return { ok: false, error: `This invoice is already ${state.status}.`, httpStatus: 409 };
  }
  if (!reasonCode) return { ok: false, error: "Pick a reason for your decision.", httpStatus: 400 };

  if (action === "reject") {
    await appendApEvent({
      workspaceId, aggregateType: "invoice", aggregateId: invoiceId, eventType: "invoice.rejected",
      payload: { reasonCode, note }, actor, now, id: newId("evt"),
    });
    return { ok: true, status: "rejected" };
  }

  if (!input.canEnter) return { ok: false, error: "limit_reached", httpStatus: 400 };

  // Seal the review clearance once. If a prior attempt sealed it but the entry then
  // failed, a retry re-enters without a duplicate — but only THIS review override is
  // deduped, not an unrelated override (e.g. a duplicate-flag clearance).
  const alreadyCleared = state.overrides.some((o) => o.field === "review");
  if (!alreadyCleared) {
    await appendApEvent({
      workspaceId, aggregateType: "invoice", aggregateId: invoiceId, eventType: "invoice.override",
      payload: { type: "review", field: "review", originalValue: "flagged", newValue: "cleared", reasonCode, note },
      actor, now, id: newId("evt"),
    });
  }

  const r = await enterInvoice({
    invoiceId,
    vendorName: state.vendor ?? "Unknown vendor",
    docNumber: invoiceId,
    txnDate: new Date(now).toISOString().slice(0, 10),
    amount: state.amount ?? 0,
    total: state.amount ?? 0,
    currency: state.currency ?? "USD",
    actor,
    auto: false,
    now,
    workspaceId,
  });
  if (!r.ok) {
    return { ok: false, error: r.error, httpStatus: r.error === "in_progress" ? 409 : 400 };
  }
  const verify = await verifyAggregate("invoice", invoiceId, workspaceId);
  return { ok: true, status: "submitted", billNumber: r.billNumber, target: r.target, verify, seal: r.seal };
}
