// AP invoice-entry control schema — data-driven config for the review/override
// policy. A single evaluator (see ./evaluate) reads this to decide auto-submit,
// second-approver, and hard-block outcomes, so changing a control is a config
// edit, not a code change. The `seal*` fields on the event records map onto the
// existing run-receipt commitment (an overridden invoice verifies the same way
// a clean one does).

// ── Identity ────────────────────────────────────────────────────────────────
export type Role = "clerk" | "approver" | "controller" | "auditor";

export type Permission =
  | "invoice.review"
  | "invoice.submit"
  | "override.duplicate"
  | "override.vendor"
  | "override.amount"
  | "override.currency"
  | "override.totals"
  | "override.gl"
  | "override.ceiling"
  | "approve.second"
  | "vendor.request"
  | "vendor.approve"
  | "vendor.bank"
  | "config.manage"
  | "audit.view";

// ── Money gates ─────────────────────────────────────────────────────────────
export interface Thresholds {
  currency: string;
  autoConfidence: number;
  approvalCeiling: number;
  dualThreshold: number;
  hardCap: number;
  totalsTolerance: number;
  totalsHardLimitPct: number;
  totalsHardLimitAbs: number;
  staleInvoiceDays: number;
}

// ── Overrides ───────────────────────────────────────────────────────────────
export type OverrideType =
  | "duplicate" | "vendor" | "amount" | "currency" | "totals" | "gl" | "ceiling";

export type SecondApprovalTrigger =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "amountAbove"; value: number }
  | { kind: "currencyDiffersFromBase" }
  | { kind: "accountFlaggedSensitive" }
  | { kind: "discrepancyAbove"; pct?: number; abs?: number };

export type HardBlock =
  | { kind: "never" }
  | { kind: "amountAbove"; value: number; unless: Permission }
  | { kind: "discrepancyAbove"; pct: number; abs: number };

export interface OverrideRule {
  type: OverrideType;
  permission: Permission;
  reasonRequired: boolean;
  secondApproval: SecondApprovalTrigger;
  hardBlock: HardBlock;
}

// ── Vendor master ───────────────────────────────────────────────────────────
export interface VendorPolicy {
  requestPermission: Permission;
  approvePermission: Permission;
  bankPermission: Permission;
  makerCheckerEnforced: boolean;
  bankChangeDualApproval: boolean;
  bankChangeOutOfBandVerify: boolean;
  firstInvoiceAlwaysReview: boolean;
  firstInvoiceSeparateApprover: boolean;
}

// ── Append-only event model ─────────────────────────────────────────────────
export interface ActorRef { userId: string; role: Role; at: number }

export type EvidenceView =
  | { artifact: "sourceInvoice"; at: number }
  | { artifact: "replay"; at: number; watchedMs?: number }
  | { artifact: "duplicateComparison"; comparedTo?: string; at: number }
  | { artifact: "vendorMatch"; at: number };

export interface OverrideEvent {
  id: string;
  invoiceId: string;
  entryRecordId: string;
  type: OverrideType;
  field: string;
  originalValue: string | number | null;
  newValue: string | number | null;
  reasonCode: string;
  reasonNote?: string;
  actor: ActorRef;
  secondApprover?: ActorRef;
  evidenceViewed: EvidenceView[];
  at: number;
  sealPrev: string;
  seal: string;
}

export interface VendorAuditEvent {
  id: string;
  vendorId: string;
  action: "requested" | "approved" | "rejected" | "bankChanged" | "bankVerified";
  actor: ActorRef;
  secondApprover?: ActorRef;
  fields?: Record<string, { from: string | null; to: string | null }>;
  reasonNote?: string;
  evidenceViewed?: EvidenceView[];
  at: number;
  sealPrev: string;
  seal: string;
}

// ── Roles & UI visibility ───────────────────────────────────────────────────
export interface RoleDef { role: Role; permissions: Permission[] }

export type UiAction =
  | "queue.view" | "queue.bulkApprove"
  | "invoice.editField" | "invoice.submit" | "invoice.reject"
  | "override.duplicate" | "override.vendor" | "override.amount"
  | "override.currency" | "override.totals"
  | "vendor.request" | "vendor.approve" | "vendor.bankEdit"
  | "config.thresholds" | "audit.export";

export const UI_REQUIRES: Record<UiAction, Permission> = {
  "queue.view": "invoice.review",
  "queue.bulkApprove": "invoice.submit",
  "invoice.editField": "invoice.review",
  "invoice.submit": "invoice.submit",
  "invoice.reject": "invoice.review",
  "override.duplicate": "override.duplicate",
  "override.vendor": "override.vendor",
  "override.amount": "override.amount",
  "override.currency": "override.currency",
  "override.totals": "override.totals",
  "vendor.request": "vendor.request",
  "vendor.approve": "vendor.approve",
  "vendor.bankEdit": "vendor.bank",
  "config.thresholds": "config.manage",
  "audit.export": "audit.view",
};

// ── Top-level config ────────────────────────────────────────────────────────
export interface ApControlConfig {
  version: number;
  orgId: string;
  thresholds: Thresholds;
  roles: RoleDef[];
  overrides: OverrideRule[];
  vendor: VendorPolicy;
  sensitiveGlAccounts: string[];
}

/** Permissions held by a role in a given config (empty if the role is absent). */
export function permsFor(config: ApControlConfig, role: Role): Permission[] {
  return config.roles.find((r) => r.role === role)?.permissions ?? [];
}

/** A UI action is shown iff the role holds the mapped permission. */
export function canSee(config: ApControlConfig, role: Role, action: UiAction): boolean {
  return permsFor(config, role).includes(UI_REQUIRES[action]);
}

// ── Sample A: small accounting firm (owner + clerk; tight limits) ────────────
export const SMALL_FIRM: ApControlConfig = {
  version: 1,
  orgId: "firm_small",
  thresholds: {
    currency: "USD", autoConfidence: 0.9,
    approvalCeiling: 1_000, dualThreshold: 5_000, hardCap: 25_000,
    totalsTolerance: 0.01, totalsHardLimitPct: 0.05, totalsHardLimitAbs: 250,
    staleInvoiceDays: 120,
  },
  roles: [
    { role: "clerk", permissions: [
      "invoice.review", "invoice.submit", "override.duplicate", "override.vendor",
      "override.amount", "override.totals", "override.gl", "vendor.request", "audit.view"] },
    { role: "controller", permissions: [
      "invoice.review", "invoice.submit", "override.duplicate", "override.vendor", "override.amount",
      "override.currency", "override.totals", "override.gl", "override.ceiling", "approve.second",
      "vendor.request", "vendor.approve", "vendor.bank", "config.manage", "audit.view"] },
  ],
  overrides: [
    { type: "duplicate", permission: "override.duplicate", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 1_000 },
      hardBlock: { kind: "amountAbove", value: 25_000, unless: "config.manage" } },
    { type: "amount", permission: "override.amount", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 5_000 },
      hardBlock: { kind: "amountAbove", value: 25_000, unless: "config.manage" } },
    { type: "vendor", permission: "override.vendor", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 5_000 }, hardBlock: { kind: "never" } },
    { type: "currency", permission: "override.currency", reasonRequired: true,
      secondApproval: { kind: "always" },
      hardBlock: { kind: "amountAbove", value: 5_000, unless: "config.manage" } },
    { type: "totals", permission: "override.totals", reasonRequired: true,
      secondApproval: { kind: "discrepancyAbove", abs: 1_000 },
      hardBlock: { kind: "discrepancyAbove", pct: 0.05, abs: 250 } },
    { type: "gl", permission: "override.gl", reasonRequired: false,
      secondApproval: { kind: "accountFlaggedSensitive" }, hardBlock: { kind: "never" } },
    { type: "ceiling", permission: "override.ceiling", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 5_000 },
      hardBlock: { kind: "amountAbove", value: 25_000, unless: "config.manage" } },
  ],
  vendor: {
    requestPermission: "vendor.request", approvePermission: "vendor.approve", bankPermission: "vendor.bank",
    makerCheckerEnforced: true, bankChangeDualApproval: true, bankChangeOutOfBandVerify: false,
    firstInvoiceAlwaysReview: true, firstInvoiceSeparateApprover: false,
  },
  sensitiveGlAccounts: ["Owner Draw", "Intercompany"],
};

// ── Sample B: larger finance team (segregated roles, higher limits) ──────────
export const LARGE_TEAM: ApControlConfig = {
  version: 1,
  orgId: "corp_finance",
  thresholds: {
    currency: "USD", autoConfidence: 0.92,
    approvalCeiling: 5_000, dualThreshold: 25_000, hardCap: 100_000,
    totalsTolerance: 0.01, totalsHardLimitPct: 0.03, totalsHardLimitAbs: 500,
    staleInvoiceDays: 90,
  },
  roles: [
    { role: "clerk", permissions: [
      "invoice.review", "invoice.submit", "override.duplicate", "override.vendor",
      "override.amount", "override.totals", "override.gl", "vendor.request"] },
    { role: "approver", permissions: [
      "invoice.review", "invoice.submit", "override.duplicate", "override.vendor", "override.amount",
      "override.currency", "override.totals", "override.gl", "override.ceiling", "approve.second",
      "vendor.request", "vendor.approve"] },
    { role: "controller", permissions: [
      "invoice.review", "invoice.submit", "override.duplicate", "override.vendor", "override.amount",
      "override.currency", "override.totals", "override.gl", "override.ceiling", "approve.second",
      "vendor.request", "vendor.approve", "vendor.bank", "config.manage", "audit.view"] },
    { role: "auditor", permissions: ["invoice.review", "audit.view"] },
  ],
  overrides: [
    { type: "duplicate", permission: "override.duplicate", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 5_000 },
      hardBlock: { kind: "amountAbove", value: 100_000, unless: "config.manage" } },
    { type: "amount", permission: "override.amount", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 25_000 },
      hardBlock: { kind: "amountAbove", value: 100_000, unless: "config.manage" } },
    { type: "vendor", permission: "override.vendor", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 25_000 }, hardBlock: { kind: "never" } },
    { type: "currency", permission: "override.currency", reasonRequired: true,
      secondApproval: { kind: "always" },
      hardBlock: { kind: "amountAbove", value: 25_000, unless: "config.manage" } },
    { type: "totals", permission: "override.totals", reasonRequired: true,
      secondApproval: { kind: "discrepancyAbove", pct: 0.01, abs: 500 },
      hardBlock: { kind: "discrepancyAbove", pct: 0.03, abs: 500 } },
    { type: "gl", permission: "override.gl", reasonRequired: true,
      secondApproval: { kind: "accountFlaggedSensitive" }, hardBlock: { kind: "never" } },
    { type: "ceiling", permission: "override.ceiling", reasonRequired: true,
      secondApproval: { kind: "amountAbove", value: 25_000 },
      hardBlock: { kind: "amountAbove", value: 100_000, unless: "config.manage" } },
  ],
  vendor: {
    requestPermission: "vendor.request", approvePermission: "vendor.approve", bankPermission: "vendor.bank",
    makerCheckerEnforced: true, bankChangeDualApproval: true, bankChangeOutOfBandVerify: true,
    firstInvoiceAlwaysReview: true, firstInvoiceSeparateApprover: true,
  },
  sensitiveGlAccounts: ["Capex", "Intercompany", "Payroll Clearing", "Tax Payable"],
};
