import { id as newId } from "../ids";
import { appendApEvent } from "./store";
import { enterInvoice, type EnterResult } from "./qbo-submit";
import { isRealIsoDate } from "./extract";
import { DEFAULT_WORKSPACE } from "./workspace";

// Turn a reviewed, extracted invoice into a real workspace invoice: seal its
// provenance (invoice.received, with the extracted fields + source), then enter
// it via the normal path (QuickBooks when connected, else the ledger). The
// result is a real, verifiable sealed record for an invoice the user brought.

export interface IntakeFields {
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO YYYY-MM-DD or "" (defaults to today)
  amount: number;
  currency: string;
}

export type IntakeResult = { invoiceId: string } & EnterResult;

const CLERK = { userId: "u_jane", role: "clerk" };

export async function intakeEnter(
  fields: IntakeFields,
  source: string,
  now: number,
  actor: { userId: string; role: string } = CLERK,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<IntakeResult> {
  const invoiceId = newId("inv");
  const vendor = fields.vendor.trim() || "Unknown vendor";
  const docNumber = fields.invoiceNumber.trim() || `UPLOAD-${invoiceId}`;
  const currency = (fields.currency.trim() || "USD").toUpperCase().slice(0, 3);
  const txnDate = isRealIsoDate(fields.invoiceDate)
    ? fields.invoiceDate
    : new Date(now).toISOString().slice(0, 10);

  await appendApEvent({
    workspaceId,
    aggregateType: "invoice",
    aggregateId: invoiceId,
    eventType: "invoice.received",
    payload: { vendor, invoiceNumber: docNumber, invoiceDate: txnDate, amount: fields.amount, currency, source },
    actor,
    now,
    id: newId("evt"),
  });

  const r = await enterInvoice({
    invoiceId,
    vendorName: vendor,
    docNumber,
    txnDate,
    amount: fields.amount,
    total: fields.amount,
    currency,
    actor,
    auto: false,
    now,
    workspaceId,
  });
  return { invoiceId, ...r };
}
