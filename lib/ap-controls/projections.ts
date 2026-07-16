import type { ApEventRow } from "./store";
import { loadAggregate } from "./store";

/**
 * AP read models (projections). The `fold*` functions are PURE and deterministic:
 * given an aggregate's ordered (and already up-cast) event stream, they return
 * typed current state with no side effects. The `project*`/`build*` helpers are
 * the impure boundary — they read the store, then fold. Persistent projection
 * tables can be layered on later; these live folds are the source of truth.
 */

// ── Small typed payload readers (payloads are stored as loose JSON) ───────────
function str(p: Record<string, unknown>, k: string): string | null {
  const v = p[k];
  return typeof v === "string" ? v : null;
}
function num(p: Record<string, unknown>, k: string): number | null {
  const v = p[k];
  return typeof v === "number" ? v : null;
}
function bool(p: Record<string, unknown>, k: string): boolean | null {
  const v = p[k];
  return typeof v === "boolean" ? v : null;
}
function strArr(p: Record<string, unknown>, k: string): string[] {
  const v = p[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── Invoice entry state ─────────────────────────────────────────────────────
export interface OverrideSummary {
  type: string;
  field: string;
  from: unknown;
  to: unknown;
  at: number;
}

export interface InvoiceEntryState {
  invoiceId: string;
  status: "new" | "needs_review" | "submitted";
  amount: number | null;
  currency: string | null;
  vendor: string | null;
  topReasonCode: string | null;
  reasonCodes: string[];
  pendingSecondApproval: boolean;
  overrides: OverrideSummary[];
  billNumber: string | null;
  submittedAuto: boolean | null;
  enteredReviewAt: number | null;
  lastSeq: number;
  lastEventAt: number | null;
  latestSeal: string | null;
}

/** Replay one invoice aggregate's stream into its current state (pure). */
export function foldInvoiceEntryState(events: ApEventRow[]): InvoiceEntryState {
  const s: InvoiceEntryState = {
    invoiceId: events[0]?.aggregateId ?? "",
    status: "new", amount: null, currency: null, vendor: null,
    topReasonCode: null, reasonCodes: [], pendingSecondApproval: false,
    overrides: [], billNumber: null, submittedAuto: null,
    enteredReviewAt: null, lastSeq: -1, lastEventAt: null, latestSeal: null,
  };

  for (const e of events) {
    s.lastSeq = e.seq;
    s.lastEventAt = e.createdAt;
    s.latestSeal = e.seal;
    const p = e.payload;

    switch (e.eventType) {
      case "invoice.review_paused": {
        s.status = "needs_review";
        s.reasonCodes = strArr(p, "reasonCodes");
        s.topReasonCode = str(p, "topReasonCode") ?? s.reasonCodes[0] ?? null;
        s.amount = num(p, "amount") ?? s.amount;
        s.currency = str(p, "currency") ?? s.currency;
        s.vendor = str(p, "vendor") ?? s.vendor;
        s.pendingSecondApproval = bool(p, "requiresSecondApproval") ?? false;
        s.enteredReviewAt = s.enteredReviewAt ?? e.createdAt;
        break;
      }
      case "invoice.override": {
        const field = str(p, "field") ?? "";
        s.overrides.push({
          type: str(p, "type") ?? "",
          field,
          from: p.originalValue ?? null,
          to: p.newValue ?? null,
          at: e.createdAt,
        });
        if (field === "total" || field === "amount") s.amount = num(p, "newValue") ?? s.amount;
        if (field === "vendor" || field === "vendorId") s.vendor = str(p, "newValue") ?? s.vendor;
        // A logged override is already fully authorized (incl. any second approver).
        s.pendingSecondApproval = false;
        break;
      }
      case "invoice.submitted": {
        s.status = "submitted";
        s.billNumber = str(p, "billNumber");
        s.amount = num(p, "total") ?? s.amount;
        s.currency = str(p, "currency") ?? s.currency;
        s.submittedAuto = bool(p, "auto");
        s.pendingSecondApproval = false;
        s.reasonCodes = [];
        s.topReasonCode = null;
        break;
      }
      default:
        break; // vendor events / unknowns don't affect an invoice aggregate
    }
  }
  return s;
}

// ── Vendor master state ─────────────────────────────────────────────────────
export interface VendorMasterState {
  vendorId: string;
  name: string | null;
  status: "none" | "requested" | "approved";
  hasBankDetails: boolean;
  bankVerified: boolean;
  bankVerification: { method: string; verifiedBy: string; at: number } | null;
  firstInvoiceReview: boolean | null;
  lastSeq: number;
  lastEventAt: number | null;
  latestSeal: string | null;
}

/** Replay one vendor aggregate's stream into its current state (pure). */
export function foldVendorMasterState(events: ApEventRow[]): VendorMasterState {
  const s: VendorMasterState = {
    vendorId: events[0]?.aggregateId ?? "",
    name: null, status: "none", hasBankDetails: false, bankVerified: false,
    bankVerification: null, firstInvoiceReview: null,
    lastSeq: -1, lastEventAt: null, latestSeal: null,
  };

  for (const e of events) {
    s.lastSeq = e.seq;
    s.lastEventAt = e.createdAt;
    s.latestSeal = e.seal;
    const p = e.payload;

    switch (e.eventType) {
      case "vendor.requested":
        s.status = "requested";
        s.name = str(p, "name") ?? s.name;
        s.hasBankDetails = bool(p, "hasBankDetails") ?? s.hasBankDetails;
        break;
      case "vendor.approved":
        s.status = "approved";
        s.firstInvoiceReview = bool(p, "firstInvoiceReview");
        break;
      case "vendor.bank_verified":
        s.bankVerified = true;
        s.bankVerification = {
          method: str(p, "method") ?? "",
          verifiedBy: str(p, "verifiedBy") ?? "",
          at: e.createdAt,
        };
        break;
      default:
        break;
    }
  }
  return s;
}

// ── Queue read model ────────────────────────────────────────────────────────
export interface InvoiceQueueItem {
  invoiceId: string;
  status: "needs_review";
  topReason: string | null;
  amount: number | null;
  currency: string | null;
  vendor: string | null;
  ageMs: number;
  pendingSecondApproval: boolean;
  latestSeal: string | null;
}

/**
 * Build the actionable-invoice queue from folded states (pure): only invoices
 * awaiting a human, ordered escalations-first then oldest-first.
 */
export function buildInvoiceQueue(states: InvoiceEntryState[], now: number): InvoiceQueueItem[] {
  return states
    .filter((s) => s.status === "needs_review")
    .map((s) => ({
      invoiceId: s.invoiceId,
      status: "needs_review" as const,
      topReason: s.topReasonCode,
      amount: s.amount,
      currency: s.currency,
      vendor: s.vendor,
      ageMs: Math.max(0, now - (s.enteredReviewAt ?? s.lastEventAt ?? now)),
      pendingSecondApproval: s.pendingSecondApproval,
      latestSeal: s.latestSeal,
    }))
    .sort(
      (a, b) =>
        Number(b.pendingSecondApproval) - Number(a.pendingSecondApproval) ||
        b.ageMs - a.ageMs,
    );
}

// ── Live projection helpers (impure: read store → fold) ─────────────────────
export async function projectInvoiceEntry(invoiceId: string): Promise<InvoiceEntryState> {
  return foldInvoiceEntryState(await loadAggregate("invoice", invoiceId));
}

export async function projectVendorMaster(vendorId: string): Promise<VendorMasterState> {
  return foldVendorMasterState(await loadAggregate("vendor", vendorId));
}

export async function projectInvoiceQueue(
  invoiceIds: string[],
  now: number,
): Promise<InvoiceQueueItem[]> {
  const states = await Promise.all(invoiceIds.map((id) => projectInvoiceEntry(id)));
  return buildInvoiceQueue(states, now);
}

/** Live queue at the current time (impure boundary — reads the clock here). */
export async function liveInvoiceQueue(invoiceIds: string[]): Promise<InvoiceQueueItem[]> {
  return projectInvoiceQueue(invoiceIds, Date.now());
}
