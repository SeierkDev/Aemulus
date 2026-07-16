import type { EvidenceView } from "./schema";
import { LARGE_TEAM } from "./schema";
import { appendApEvent, readAggregate } from "./store";

/**
 * Fixtures + seed for the first AP review demo (Acme duplicate-suspicion invoice).
 *
 * MOCKED: OCR/extraction, the duplicate-detection result, the replay asset, auth
 * (one hard-coded reviewer), and the QuickBooks keying. REAL: the whole control
 * spine — evaluateOverride → writeOverrideEvent → appendApEvent → projections →
 * verifyAggregate — runs against the live ap_events store.
 */

export const DEMO_INVOICE_ID = "ap_demo_acme";
export const DEMO_ACTOR = { userId: "u_jane", role: "clerk" as const, name: "Jane D." };
// $5,000 ceiling → a $1,842 duplicate override is a clean single-approver `allow`.
export const DEMO_CONFIG = LARGE_TEAM;

// Evidence the reviewer must view before the duplicate override is allowed.
export const REQUIRED_EVIDENCE: EvidenceView["artifact"][] = [
  "sourceInvoice",
  "duplicateComparison",
  "replay",
];

export const OVERRIDE_REASONS = [
  { code: "LEGIT_REBILL", label: "Legitimate re-bill" },
  { code: "VENDOR_REISSUED", label: "Vendor reissued the invoice" },
  { code: "DIFFERENT_PERIOD", label: "Different billing period" },
] as const;

export const DEMO_FIXTURE = {
  vendor: "Acme Corp",
  invoiceNumber: "INV-2025-0417",
  invoiceDate: "2025-04-17",
  amount: 1842.0,
  currency: "USD",
  glAccount: "6000 · Office Supplies",
  terms: "Net 30",
  poNumber: "PO-5521",
  lineItems: [
    { desc: "Copy paper, 10 cases", qty: 10, unit: 42.5, total: 425.0 },
    { desc: "Toner cartridges (HP 26X)", qty: 6, unit: 189.0, total: 1134.0 },
    { desc: "Misc. office supplies", qty: 1, unit: 130.5, total: 130.5 },
  ],
  subtotal: 1689.5,
  tax: 152.5,
  fields: [
    { key: "vendor", label: "Vendor", value: "Acme Corp", confidence: 0.98 },
    { key: "invoiceNumber", label: "Invoice #", value: "INV-2025-0417", confidence: 0.95 },
    { key: "invoiceDate", label: "Date", value: "2025-04-17", confidence: 0.93 },
    { key: "amount", label: "Amount", value: "$1,842.00", confidence: 0.9 },
    { key: "glAccount", label: "GL account", value: "6000 · Office Supplies", confidence: 0.88 },
  ],
  // MOCKED duplicate-detection result: the already-entered bill it looks like.
  duplicateOf: {
    billNumber: "#1043",
    vendor: "Acme Corp",
    invoiceNumber: "INV-2025-0391",
    amount: "$1,842.00",
    date: "2025-03-02",
    enteredAt: "Mar 2, 2025 by Jane D.",
  },
  reasonCodes: ["DUPLICATE"],
  topReasonCode: "DUPLICATE",
  banner: "Held for review: it looks like a duplicate (of bill #1043).",
  // MOCKED replay: a canned filmstrip of what the agent did up to the pause.
  replayFrames: [
    "Opened the accounting portal and started a new bill",
    "Selected vendor “Acme Corp”",
    "Entered invoice # INV-2025-0417 and date 2025-04-17",
    "Began entering the amount — duplicate check fired, paused for review",
  ],
} as const;

/** Seed the demo invoice's paused-for-review event once (idempotent). */
export async function seedApDemo(): Promise<void> {
  const existing = await readAggregate("invoice", DEMO_INVOICE_ID);
  if (existing.length > 0) return;
  await appendApEvent({
    aggregateType: "invoice",
    aggregateId: DEMO_INVOICE_ID,
    eventType: "invoice.review_paused",
    payload: {
      reasonCodes: [...DEMO_FIXTURE.reasonCodes],
      topReasonCode: DEMO_FIXTURE.topReasonCode,
      banner: DEMO_FIXTURE.banner,
      amount: DEMO_FIXTURE.amount,
      currency: DEMO_FIXTURE.currency,
      vendor: DEMO_FIXTURE.vendor,
      requiresSecondApproval: false,
    },
    actor: { userId: "system", role: "system" },
    now: Date.now() - 12 * 60 * 1000, // entered the queue ~12 min ago
    id: `${DEMO_INVOICE_ID}_paused`,
  });
}
