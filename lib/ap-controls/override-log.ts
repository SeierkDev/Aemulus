import { createHash } from "node:crypto";
import type {
  ActorRef,
  ApControlConfig,
  EvidenceView,
  OverrideEvent,
  OverrideType,
} from "./schema";
import { type Actor, type EvalResult, checkSecondApprover } from "./evaluate";

/**
 * Append-only override-log writer.
 *
 * Turns an authorized override into a sealed OverrideEvent that chains onto the
 * invoice's prior Entry Record seal. Each event's `seal` is the sha256 of its own
 * canonical serialization (which includes `sealPrev`), so any later edit to any
 * event breaks the chain from that point forward. The writer never mutates prior
 * events and always preserves the original (AI-extracted) value alongside the new
 * one - the record is grow-only.
 */

export class OverrideWriteError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OverrideWriteError";
    this.code = code;
  }
}

// The reviewer must have actually looked before an override can be logged.
const DEFAULT_REQUIRED_EVIDENCE: EvidenceView["artifact"][] = ["sourceInvoice", "replay"];

export interface OverrideLogInput {
  /** Seal of the prior Entry Record (or the previous override event). */
  priorSeal: string;
  invoiceId: string;
  entryRecordId: string;
  /** The evaluator's verdict for this override. */
  decision: EvalResult;
  type: OverrideType;
  field: string;
  originalValue: string | number | null;
  newValue: string | number | null;
  reason: { code: string; note?: string };
  actor: Actor;
  preparerId: string;
  secondApprover?: Actor;
  evidenceViewed: EvidenceView[];
  config: ApControlConfig;
  now: number;
  id: string;
  /** Artifacts that must appear in evidenceViewed (default: source invoice + replay). */
  requiredEvidence?: EvidenceView["artifact"][];
}

/** Deterministic JSON: object keys sorted, undefined dropped, array order kept. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(",")}}`;
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** The exact string a seal is computed over (the event minus its own seal). */
export function hashInputFor(event: Omit<OverrideEvent, "seal">): string {
  return canonicalize(event);
}

/**
 * Build and seal one append-only OverrideEvent. Throws OverrideWriteError unless
 * the write is authorized: the decision is `allow`, or it's `require_second` with
 * a valid second approver already supplied. Also requires a reason and that the
 * required evidence was viewed.
 */
export function writeOverrideEvent(input: OverrideLogInput): OverrideEvent {
  // 1) Every audit entry carries a reason.
  if (!input.reason.code?.trim()) {
    throw new OverrideWriteError("REASON_REQUIRED", "An override cannot be logged without a reason code.");
  }

  // 2) The reviewer must have viewed the required evidence.
  const required = input.requiredEvidence ?? DEFAULT_REQUIRED_EVIDENCE;
  const seen = new Set(input.evidenceViewed.map((e) => e.artifact));
  const missing = required.filter((a) => !seen.has(a));
  if (missing.length > 0) {
    throw new OverrideWriteError("EVIDENCE_REQUIRED", `Required evidence not viewed: ${missing.join(", ")}.`);
  }

  // 3) Authorization: only `allow`, or `require_second` now satisfied by a valid
  //    second approver. Anything else (block / needs_review / unsatisfied) is refused.
  const decision = input.decision.decision;
  if (decision === "allow") {
    // authorized
  } else if (decision === "require_second") {
    if (!input.secondApprover) {
      throw new OverrideWriteError("SECOND_APPROVER_REQUIRED", "This override requires a second approver before it can be logged.");
    }
    const check = checkSecondApprover(input.config, input.actor, input.preparerId, input.secondApprover);
    if (check !== "ok") {
      throw new OverrideWriteError(
        "INVALID_SECOND_APPROVER",
        check === "maker_checker"
          ? "The second approver cannot be the preparer or the person making the change."
          : "The second approver is not authorized to give a second approval.",
      );
    }
  } else {
    throw new OverrideWriteError("NOT_AUTHORIZED", `Cannot log an override whose decision is '${decision}'.`);
  }

  // 4) Build the event (original value preserved, undefined keys omitted so the
  //    seal is stable across JSON round-trips).
  const actor: ActorRef = { userId: input.actor.userId, role: input.actor.role, at: input.now };
  const second: ActorRef | undefined = input.secondApprover
    ? { userId: input.secondApprover.userId, role: input.secondApprover.role, at: input.now }
    : undefined;

  const unsealed: Omit<OverrideEvent, "seal"> = {
    id: input.id,
    invoiceId: input.invoiceId,
    entryRecordId: input.entryRecordId,
    type: input.type,
    field: input.field,
    originalValue: input.originalValue,
    newValue: input.newValue,
    reasonCode: input.reason.code,
    ...(input.reason.note ? { reasonNote: input.reason.note } : {}),
    actor,
    ...(second ? { secondApprover: second } : {}),
    evidenceViewed: input.evidenceViewed,
    at: input.now,
    sealPrev: input.priorSeal,
  };

  return { ...unsealed, seal: sha256hex(hashInputFor(unsealed)) };
}

/**
 * Verify a chain of override events links unbroken back to `genesisSeal`. Returns
 * the first index where continuity or a seal fails to recompute, if any.
 */
export function verifyOverrideChain(
  genesisSeal: string,
  events: OverrideEvent[],
): { valid: boolean; brokenAt?: number } {
  let prev = genesisSeal;
  for (let i = 0; i < events.length; i++) {
    const { seal, ...unsealed } = events[i];
    if (unsealed.sealPrev !== prev) return { valid: false, brokenAt: i };
    if (sha256hex(hashInputFor(unsealed)) !== seal) return { valid: false, brokenAt: i };
    prev = seal;
  }
  return { valid: true };
}
