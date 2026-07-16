import {
  type ApControlConfig,
  type OverrideType,
  type Role,
  type SecondApprovalTrigger,
  type Thresholds,
  permsFor,
} from "./schema";

// ── Decision output ─────────────────────────────────────────────────────────
export type Decision = "allow" | "needs_review" | "require_second" | "block";

export interface Reason {
  code: string;
  field?: string;
  detail?: Record<string, unknown>;
}

export interface EvalResult {
  decision: Decision;
  reasons: Reason[];
  /** Every rule id that fired, for audit + debugging. */
  triggeredRuleIds: string[];
  /** Plain-finance-language line for the UI banner. */
  banner: string;
}

// ── Inputs ──────────────────────────────────────────────────────────────────
export interface ExtractedField {
  field: string;
  value: string | number | null;
  confidence: number;
}

export interface InvoiceFacts {
  total: number;
  currency: string;
  invoiceDate: number; // epoch ms
  vendorStatus: "matched" | "ambiguous" | "unknown"; // unknown = new vendor
  duplicateOf: string | null;
  totalsReconciled: boolean;
  totalsDiscrepancy: number; // absolute
  glAccount: string | null;
  glSensitive: boolean;
  usedFallbackOnCritical: boolean; // AI fallback on amount/vendor/account
  outcomeConfirmed: boolean;
}

export interface AutoSubmitInput {
  facts: InvoiceFacts;
  fields: ExtractedField[];
  config: ApControlConfig;
  now: number;
}

export interface Actor {
  userId: string;
  role: Role;
}

export interface OverrideFacts {
  total: number;
  currency: string;
  totalsDiscrepancy: number;
  glSensitive: boolean;
}

export interface OverrideInput {
  type: OverrideType;
  facts: OverrideFacts;
  actor: Actor;
  /** Who prepared/submitted this invoice — cannot be the second approver. */
  preparerId: string;
  secondApprover?: Actor;
  reason?: string;
  config: ApControlConfig;
}

// The fields an auto-submit requires to be present + confident.
export const REQUIRED_FIELDS = [
  "vendor", "invoiceNumber", "invoiceDate", "subtotal", "tax", "total",
] as const;

// ── evaluateAutoSubmit ──────────────────────────────────────────────────────
/**
 * Decide whether an invoice may be keyed automatically. Every gate must pass;
 * any failure routes it to a human (needs_review) with machine-readable reasons.
 */
export function evaluateAutoSubmit(input: AutoSubmitInput): EvalResult {
  const { facts, fields, config, now } = input;
  const t = config.thresholds;
  const reasons: Reason[] = [];
  const ruleIds: string[] = [];
  const add = (id: string, code: string, field?: string, detail?: Record<string, unknown>) => {
    ruleIds.push(id);
    reasons.push({ code, field, detail });
  };

  const byName = new Map(fields.map((f) => [f.field, f]));
  for (const name of REQUIRED_FIELDS) {
    const f = byName.get(name);
    if (!f || f.value === null || f.value === "") {
      add("AUTO.COMPLETENESS", "REQUIRED_FIELD_MISSING", name);
    } else if (f.confidence < t.autoConfidence) {
      add("AUTO.CONFIDENCE", "LOW_CONFIDENCE", name, { confidence: f.confidence, need: t.autoConfidence });
    }
  }
  if (facts.usedFallbackOnCritical) add("AUTO.CONFIDENCE", "FALLBACK_ON_CRITICAL");

  if (!facts.totalsReconciled || facts.totalsDiscrepancy > t.totalsTolerance) {
    add("AUTO.TOTALS", "TOTALS_MISMATCH", "total", { discrepancy: facts.totalsDiscrepancy });
  }

  const ageDays = (now - facts.invoiceDate) / 86_400_000;
  if (facts.invoiceDate > now) add("AUTO.DATE", "FUTURE_DATE", "invoiceDate");
  else if (ageDays > t.staleInvoiceDays) add("AUTO.DATE", "STALE_DATE", "invoiceDate", { ageDays: Math.round(ageDays) });

  if (facts.currency !== t.currency) add("AUTO.CURRENCY", "FOREIGN_CURRENCY", "currency", { currency: facts.currency });

  if (facts.vendorStatus === "unknown") add("AUTO.VENDOR", "NEW_VENDOR", "vendor");
  else if (facts.vendorStatus === "ambiguous") add("AUTO.VENDOR", "AMBIGUOUS_VENDOR", "vendor");

  if (facts.duplicateOf) add("AUTO.DUPLICATE", "DUPLICATE", "invoiceNumber", { duplicateOf: facts.duplicateOf });

  if (facts.total > t.approvalCeiling) {
    add("AUTO.CEILING", "OVER_CEILING", "total", { total: facts.total, ceiling: t.approvalCeiling });
  }

  if (facts.glAccount == null) add("AUTO.GL", "GL_UNDETERMINED", "glAccount");
  if (!facts.outcomeConfirmed) add("AUTO.OUTCOME", "OUTCOME_UNCONFIRMED");

  if (reasons.length === 0) {
    return { decision: "allow", reasons: [], triggeredRuleIds: [], banner: "Ready to enter automatically — all checks passed." };
  }
  return {
    decision: "needs_review",
    reasons,
    triggeredRuleIds: ruleIds,
    banner: `Held for review: ${reasons.map((r) => phrase(r)).join("; ")}.`,
  };
}

/**
 * Validate a proposed second approver: must be a different person from both the
 * preparer and the actor (maker-checker), and must hold `approve.second`. Shared
 * by the evaluator and the append-only override-log writer.
 */
export function checkSecondApprover(
  config: ApControlConfig,
  actor: Actor,
  preparerId: string,
  second: Actor,
): "ok" | "maker_checker" | "not_authorized" {
  if (second.userId === preparerId || second.userId === actor.userId) return "maker_checker";
  if (!permsFor(config, second.role).includes("approve.second")) return "not_authorized";
  return "ok";
}

// ── evaluateOverride ────────────────────────────────────────────────────────
/**
 * Decide whether a reviewer's override may proceed: allow, require_second (needs
 * a valid second approver), or block. Enforces maker-checker — the preparer and
 * the actor can never be the second approver, and the second approver must hold
 * `approve.second`.
 */
export function evaluateOverride(input: OverrideInput): EvalResult {
  const { type, facts, actor, preparerId, secondApprover, reason, config } = input;
  const t = config.thresholds;

  const rule = config.overrides.find((r) => r.type === type);
  if (!rule) {
    return mk("block", [{ code: "UNKNOWN_OVERRIDE" }], ["OVERRIDE.UNKNOWN"], `No control is configured for a ${label(type)} override.`);
  }

  const actorPerms = permsFor(config, actor.role);
  if (!actorPerms.includes(rule.permission)) {
    return mk("block", [{ code: "NOT_PERMITTED", detail: { role: actor.role, need: rule.permission } }],
      ["OVERRIDE.PERMISSION"], `A ${actor.role} can't override ${label(type)}.`);
  }

  if (rule.reasonRequired && !reason?.trim()) {
    return mk("block", [{ code: "REASON_REQUIRED" }], ["OVERRIDE.REASON"], `A reason is required to override ${label(type)}.`);
  }

  // Hard blocks.
  const hb = rule.hardBlock;
  let forcedSecondByCap = false;
  if (hb.kind === "amountAbove" && facts.total > hb.value) {
    if (!actorPerms.includes(hb.unless)) {
      return mk("block", [{ code: "HARD_CAP", field: "total", detail: { total: facts.total, cap: hb.value } }],
        ["OVERRIDE.HARDCAP"], `Blocked: a ${label(type)} override over ${money(hb.value)} needs a Controller.`);
    }
    forcedSecondByCap = true; // Controller may proceed, but a second approver is still required.
  }
  if (hb.kind === "discrepancyAbove") {
    if (facts.totalsDiscrepancy > hb.pct * facts.total || facts.totalsDiscrepancy > hb.abs) {
      return mk("block", [{ code: "TOTALS_HARD_LIMIT", field: "total", detail: { discrepancy: facts.totalsDiscrepancy } }],
        ["OVERRIDE.HARDLIMIT"], `Blocked: the totals differ by more than the allowed limit — re-key or reject this invoice.`);
    }
  }

  const needsSecond = forcedSecondByCap || triggered(rule.secondApproval, facts, t);
  if (needsSecond) {
    const ruleIds = ["OVERRIDE.SECOND"];
    if (!secondApprover) {
      return mk("require_second", [{ code: "SECOND_REQUIRED" }], ruleIds,
        `A second approver is required to override ${label(type)}${forcedSecondByCap ? " above the limit" : ""}.`);
    }
    const check = checkSecondApprover(config, actor, preparerId, secondApprover);
    if (check === "maker_checker") {
      return mk("block", [{ code: "MAKER_CHECKER_VIOLATION" }], [...ruleIds, "OVERRIDE.MAKER_CHECKER"],
        `This can't be the second approver — the same person prepared or made this change. A different person must approve.`);
    }
    if (check === "not_authorized") {
      return mk("block", [{ code: "SECOND_APPROVER_NOT_AUTHORIZED", detail: { role: secondApprover.role } }],
        [...ruleIds, "OVERRIDE.SECOND_AUTH"], `A ${secondApprover.role} isn't authorized to give a second approval.`);
    }
    return mk("allow", [], ruleIds, `${cap(label(type))} override approved with a second approver.`);
  }

  return mk("allow", [], [], `${cap(label(type))} override approved.`);
}

// ── helpers ─────────────────────────────────────────────────────────────────
function triggered(tr: SecondApprovalTrigger, f: OverrideFacts, t: Thresholds): boolean {
  switch (tr.kind) {
    case "always": return true;
    case "never": return false;
    case "amountAbove": return f.total > tr.value;
    case "currencyDiffersFromBase": return f.currency !== t.currency;
    case "accountFlaggedSensitive": return f.glSensitive;
    case "discrepancyAbove":
      return (
        (tr.pct != null && f.totalsDiscrepancy > tr.pct * f.total) ||
        (tr.abs != null && f.totalsDiscrepancy > tr.abs)
      );
  }
}

function mk(decision: Decision, reasons: Reason[], triggeredRuleIds: string[], banner: string): EvalResult {
  return { decision, reasons, triggeredRuleIds, banner };
}

const LABELS: Record<OverrideType, string> = {
  duplicate: "duplicate", vendor: "the vendor", amount: "the amount",
  currency: "the currency", totals: "the totals", gl: "the account", ceiling: "the approval limit",
};
function label(t: OverrideType): string { return LABELS[t]; }
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function money(n: number): string { return `$${n.toLocaleString("en-US")}`; }

const PHRASES: Record<string, string> = {
  REQUIRED_FIELD_MISSING: "a required field is missing",
  LOW_CONFIDENCE: "a field was read with low confidence",
  FALLBACK_ON_CRITICAL: "the amount or vendor needed a best-guess read",
  TOTALS_MISMATCH: "the line items don't add up to the total",
  FUTURE_DATE: "the invoice date is in the future",
  STALE_DATE: "the invoice is unusually old",
  FOREIGN_CURRENCY: "it's in a foreign currency",
  NEW_VENDOR: "the vendor isn't on file",
  AMBIGUOUS_VENDOR: "the vendor matches more than one on file",
  DUPLICATE: "it looks like a duplicate",
  OVER_CEILING: "the amount is over the auto-entry limit",
  GL_UNDETERMINED: "the expense account is unclear",
  OUTCOME_UNCONFIRMED: "we couldn't confirm the bill was created",
};
function phrase(r: Reason): string {
  const base = PHRASES[r.code] ?? r.code.toLowerCase().replace(/_/g, " ");
  return r.field && r.code === "LOW_CONFIDENCE" ? `${base} (${r.field})` : base;
}
