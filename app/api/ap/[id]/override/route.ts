import { NextResponse } from "next/server";
import { id as newId } from "@/lib/ids";
import {
  DEMO_INVOICE_ID,
  DEMO_FIXTURE,
  DEMO_CONFIG,
  DEMO_ACTOR,
  REQUIRED_EVIDENCE,
} from "@/lib/ap-controls/demo";
import { evaluateOverride } from "@/lib/ap-controls/evaluate";
import { writeOverrideEvent, OverrideWriteError } from "@/lib/ap-controls/override-log";
import { appendApEvent, readAggregate } from "@/lib/ap-controls/store";
import { projectInvoiceEntry } from "@/lib/ap-controls/projections";
import type { EvidenceView } from "@/lib/ap-controls/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Demo endpoint: mocked auth (one hard-coded reviewer), scoped to the demo
// invoice only. The control spine it calls is real.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id !== DEMO_INVOICE_ID) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    reasonCode?: string;
    note?: string;
    evidenceViewed?: string[];
  };
  const reasonCode = String(body.reasonCode ?? "");
  const note = body.note ? String(body.note) : undefined;
  const evidenceViewed = Array.isArray(body.evidenceViewed) ? body.evidenceViewed : [];
  const now = Date.now();
  const actor = { userId: DEMO_ACTOR.userId, role: DEMO_ACTOR.role };

  // 1) Override decision (REAL).
  const decision = evaluateOverride({
    type: "duplicate",
    facts: { total: DEMO_FIXTURE.amount, currency: DEMO_FIXTURE.currency, totalsDiscrepancy: 0, glSensitive: false },
    actor,
    preparerId: "system",
    reason: reasonCode,
    config: DEMO_CONFIG,
  });
  const trace: { call: string; result: string }[] = [
    { call: "evaluateOverride(duplicate)", result: decision.decision },
  ];
  if (decision.decision !== "allow") {
    return NextResponse.json({ ok: false, decision: decision.decision, banner: decision.banner, trace }, { status: 400 });
  }

  // 2) Sealed override event (REAL) — enforces reason + evidence-viewed.
  const evidence = evidenceViewed.map(
    (a) => ({ artifact: a as EvidenceView["artifact"], at: now }) as EvidenceView,
  );
  const prior = await readAggregate("invoice", id);
  const priorSeal = prior[prior.length - 1]?.seal ?? `genesis:invoice:${id}`;
  let sealed;
  try {
    sealed = writeOverrideEvent({
      priorSeal, invoiceId: id, entryRecordId: id, decision,
      type: "duplicate", field: "duplicate", originalValue: "flagged", newValue: "cleared",
      reason: { code: reasonCode, note }, actor, preparerId: "system",
      evidenceViewed: evidence, config: DEMO_CONFIG, now, id: newId("ovr"),
      requiredEvidence: REQUIRED_EVIDENCE,
    });
  } catch (e) {
    const err = e as OverrideWriteError;
    return NextResponse.json({ ok: false, decision: "blocked", banner: err.message, code: err.code, trace }, { status: 400 });
  }
  trace.push({ call: "writeOverrideEvent", result: `sealed ${sealed.seal.slice(0, 10)}…` });

  // 3) Append to the aggregate's stream (REAL).
  const row = await appendApEvent({
    aggregateType: "invoice", aggregateId: id, eventType: "invoice.override",
    payload: { type: "duplicate", field: "duplicate", originalValue: "flagged", newValue: "cleared", reasonCode, note, overrideSeal: sealed.seal },
    actor, now, id: newId("evt"),
  });
  trace.push({ call: "appendApEvent(invoice.override)", result: `seq ${row.seq}` });

  // 4) Projection refresh (REAL).
  const state = await projectInvoiceEntry(id);
  trace.push({ call: "projectInvoiceEntry", result: `status ${state.status}` });

  return NextResponse.json({ ok: true, decision: "allow", state, trace });
}
