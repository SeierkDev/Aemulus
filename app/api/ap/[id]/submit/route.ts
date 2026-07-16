import { NextResponse } from "next/server";
import { id as newId } from "@/lib/ids";
import { DEMO_INVOICE_ID, DEMO_FIXTURE, DEMO_ACTOR } from "@/lib/ap-controls/demo";
import { appendApEvent, verifyAggregate } from "@/lib/ap-controls/store";
import { projectInvoiceEntry } from "@/lib/ap-controls/projections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mocked QuickBooks keying: generates a fake bill number and records the
// submission event. The append + verify + projection are real.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id !== DEMO_INVOICE_ID) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = Date.now();
  const actor = { userId: DEMO_ACTOR.userId, role: DEMO_ACTOR.role };
  const billNumber = `QB-${8000 + (Math.floor(now / 1000) % 2000)}`; // MOCKED

  // 1) Record the submission (REAL).
  const row = await appendApEvent({
    aggregateType: "invoice", aggregateId: id, eventType: "invoice.submitted",
    payload: { billNumber, total: DEMO_FIXTURE.amount, currency: DEMO_FIXTURE.currency, auto: false },
    actor, now, id: newId("evt"),
  });
  const trace: { call: string; result: string }[] = [
    { call: "appendApEvent(invoice.submitted)", result: `seq ${row.seq}` },
  ];

  // 2) Verify the whole sealed stream (REAL) — this backs the "Sealed" badge.
  const verify = await verifyAggregate("invoice", id);
  trace.push({ call: "verifyAggregate", result: verify.valid ? `✓ intact (${verify.length} events)` : `✗ ${verify.reason}` });

  // 3) Projection refresh (REAL) — removes the row from the queue.
  const state = await projectInvoiceEntry(id);
  trace.push({ call: "projectInvoiceEntry", result: `status ${state.status}` });

  return NextResponse.json({ ok: true, billNumber, verify, state, seal: row.seal, trace });
}
