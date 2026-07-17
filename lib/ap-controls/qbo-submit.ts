import { qboConfigFromConnection } from "../qbo/oauth";
import { writeInvoiceToQbo } from "../qbo/write";
import { recordLedgerBill, deleteLedgerBill } from "./ledger";
import { id as newId } from "../ids";
import { appendApEvent, verifyAggregate, SequenceConflictError } from "./store";
import { projectInvoiceEntry } from "./projections";
import { DEFAULT_WORKSPACE } from "./workspace";

// Enter one reviewed invoice into QuickBooks and seal the real Bill id into the
// invoice's audit stream. Idempotent at both layers: writeInvoiceToQbo guards
// the QBO Bill, and this guards the invoice.submitted event (an already-submitted
// invoice returns its existing bill instead of appending again).

export interface EnterInvoiceInput {
  invoiceId: string;
  vendorName: string;
  docNumber: string;
  txnDate: string; // YYYY-MM-DD
  amount: number;
  total: number;
  currency: string;
  actor: { userId: string; role: string };
  /** true when auto-entered (no human review); false when a reviewer entered it. */
  auto?: boolean;
  now: number;
  workspaceId?: string;
}

export type EnterTarget = "quickbooks" | "ledger";
export type EnterResult =
  | { ok: true; billNumber: string; target: EnterTarget; verify: { valid: boolean; length: number }; seal: string }
  | { ok: false; error: string };

export async function enterInvoice(input: EnterInvoiceInput): Promise<EnterResult> {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE;

  // Already entered? Return the existing bill (idempotent at the AP layer) — a
  // re-entry never consumes quota.
  const pre = await projectInvoiceEntry(input.invoiceId, workspaceId);
  if (pre.status === "submitted" && pre.billNumber) {
    const verify = await verifyAggregate("invoice", input.invoiceId, workspaceId);
    return { ok: true, billNumber: pre.billNumber, target: pre.enterTarget ?? "ledger", verify, seal: pre.latestSeal ?? "" };
  }

  // Enter into QuickBooks when connected, otherwise the built-in ledger. Both
  // paths produce a real bill number and are sealed identically.
  let billNumber: string;
  let target: EnterTarget;
  let config;
  try {
    config = await qboConfigFromConnection(input.now, workspaceId);
  } catch {
    // A QuickBooks token exchange/refresh failed — surface it as a clean, retryable
    // failure instead of letting it escape as a 500 (and instead of silently
    // entering to the ledger under a different target than the user connected).
    return { ok: false, error: "qbo_unavailable" };
  }
  if (config) {
    const result = await writeInvoiceToQbo({
      invoiceId: input.invoiceId,
      vendorName: input.vendorName,
      docNumber: input.docNumber,
      txnDate: input.txnDate,
      amount: input.amount,
      config,
      now: input.now,
      workspaceId,
    });
    if (result.status !== "posted") {
      return { ok: false, error: result.status === "in_progress" ? "in_progress" : result.error };
    }
    billNumber = result.billId;
    target = "quickbooks";
  } else {
    const led = await recordLedgerBill({
      invoiceId: input.invoiceId,
      vendor: input.vendorName,
      docNumber: input.docNumber,
      amount: input.amount,
      currency: input.currency,
      now: input.now,
      workspaceId,
    });
    billNumber = led.billNumber;
    target = "ledger";
  }

  // Seal the real bill id into the audit stream. Claim the exact next sequence so
  // two concurrent entries of the same invoice can't both append a submitted event.
  let row;
  try {
    row = await appendApEvent({
      workspaceId,
      aggregateType: "invoice",
      aggregateId: input.invoiceId,
      eventType: "invoice.submitted",
      payload: { billNumber, total: input.total, currency: input.currency, auto: input.auto ?? false, target },
      actor: input.actor,
      now: input.now,
      id: newId("evt"),
      expectedSeq: pre.lastSeq + 1,
    });
  } catch (e) {
    if (e instanceof SequenceConflictError) {
      // A concurrent writer won the slot — return the committed result idempotently.
      const after = await projectInvoiceEntry(input.invoiceId, workspaceId);
      if (after.status === "submitted" && after.billNumber) {
        const verify = await verifyAggregate("invoice", input.invoiceId, workspaceId);
        return { ok: true, billNumber: after.billNumber, target: after.enterTarget ?? target, verify, seal: after.latestSeal ?? "" };
      }
      // The invoice did NOT end up submitted (e.g. a concurrent reject took the
      // slot). We already wrote a ledger bill above; roll it back so the ledger
      // doesn't hold a bill for an invoice the sealed stream says was rejected.
      // (A QBO post can't be un-posted here; that path is inert unless QBO is
      // connected, and writeInvoiceToQbo is itself idempotent.)
      if (target === "ledger") {
        await deleteLedgerBill(input.invoiceId, workspaceId);
      }
      return { ok: false, error: "in_progress" };
    }
    throw e;
  }
  const verify = await verifyAggregate("invoice", input.invoiceId, workspaceId);
  return { ok: true, billNumber, target, verify, seal: row.seal };
}
