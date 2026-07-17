import { qboConfigFromConnection } from "../qbo/oauth";
import { writeInvoiceToQbo } from "../qbo/write";
import { recordLedgerBill } from "./ledger";
import { id as newId } from "../ids";
import { appendApEvent, verifyAggregate } from "./store";
import { projectInvoiceEntry } from "./projections";

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
  now: number;
}

export type EnterTarget = "quickbooks" | "ledger";
export type EnterResult =
  | { ok: true; billNumber: string; target: EnterTarget; verify: { valid: boolean; length: number }; seal: string }
  | { ok: false; error: string };

export async function enterInvoice(input: EnterInvoiceInput): Promise<EnterResult> {
  // Already entered? Return the existing bill (idempotent at the AP layer).
  const pre = await projectInvoiceEntry(input.invoiceId);
  if (pre.status === "submitted" && pre.billNumber) {
    const verify = await verifyAggregate("invoice", input.invoiceId);
    return { ok: true, billNumber: pre.billNumber, target: pre.enterTarget ?? "ledger", verify, seal: pre.latestSeal ?? "" };
  }

  // Enter into QuickBooks when connected, otherwise the built-in ledger. Both
  // paths produce a real bill number and are sealed identically.
  let billNumber: string;
  let target: EnterTarget;
  const config = await qboConfigFromConnection(input.now);
  if (config) {
    const result = await writeInvoiceToQbo({
      invoiceId: input.invoiceId,
      vendorName: input.vendorName,
      docNumber: input.docNumber,
      txnDate: input.txnDate,
      amount: input.amount,
      config,
      now: input.now,
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
    });
    billNumber = led.billNumber;
    target = "ledger";
  }

  // Seal the real bill id into the audit stream.
  const row = await appendApEvent({
    aggregateType: "invoice",
    aggregateId: input.invoiceId,
    eventType: "invoice.submitted",
    payload: { billNumber, total: input.total, currency: input.currency, auto: false, target },
    actor: input.actor,
    now: input.now,
    id: newId("evt"),
  });
  const verify = await verifyAggregate("invoice", input.invoiceId);
  return { ok: true, billNumber, target, verify, seal: row.seal };
}
