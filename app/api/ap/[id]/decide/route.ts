import { NextResponse } from "next/server";
import { id as newId } from "@/lib/ids";
import { DEMO_INVOICE_ID, DEMO_ACTOR } from "@/lib/ap-controls/demo";
import { appendApEvent, verifyAggregate } from "@/lib/ap-controls/store";
import { projectInvoiceEntry } from "@/lib/ap-controls/projections";
import { enterInvoice } from "@/lib/ap-controls/qbo-submit";
import { getApViewer, viewerActor, viewerEntitlement } from "@/lib/ap-controls/ap-viewer";
import { DEFAULT_WORKSPACE } from "@/lib/ap-controls/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generic review decision for any workspace invoice awaiting a human (the demo
// invoice keeps its own richer flow). Approve → sealed override + enter; reject →
// sealed rejection. Both are appended to the tamper-evident audit stream.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id === DEMO_INVOICE_ID) return NextResponse.json({ ok: false, error: "Use the walkthrough for this invoice." }, { status: 404 });

  const viewer = await getApViewer().catch(() => null);
  const workspaceId = viewer?.workspaceId ?? DEFAULT_WORKSPACE;
  const actor = viewer ? viewerActor(viewer) : { userId: DEMO_ACTOR.userId, role: DEMO_ACTOR.role };

  const state = await projectInvoiceEntry(id, workspaceId);
  if (state.status !== "needs_review") {
    return NextResponse.json({ ok: false, error: `This invoice is already ${state.status}.` }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; reasonCode?: string; note?: string };
  const action = body.action === "reject" ? "reject" : "approve";
  const reasonCode = String(body.reasonCode ?? "").trim();
  const note = body.note ? String(body.note) : undefined;
  if (!reasonCode) return NextResponse.json({ ok: false, error: "Pick a reason for your decision." }, { status: 400 });

  const now = Date.now();

  if (action === "reject") {
    await appendApEvent({
      workspaceId, aggregateType: "invoice", aggregateId: id, eventType: "invoice.rejected",
      payload: { reasonCode, note }, actor, now, id: newId("evt"),
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve: enforce the viewer's plan/tier, then seal the override and enter.
  if (viewer && !(await viewerEntitlement(viewer, now)).canEnter) {
    return NextResponse.json({ ok: false, error: "limit_reached" }, { status: 400 });
  }
  await appendApEvent({
    workspaceId, aggregateType: "invoice", aggregateId: id, eventType: "invoice.override",
    payload: { type: "review", field: "review", originalValue: "flagged", newValue: "cleared", reasonCode, note },
    actor, now, id: newId("evt"),
  });

  const r = await enterInvoice({
    invoiceId: id,
    vendorName: state.vendor ?? "Unknown vendor",
    docNumber: id,
    txnDate: new Date(now).toISOString().slice(0, 10),
    amount: state.amount ?? 0,
    total: state.amount ?? 0,
    currency: state.currency ?? "USD",
    actor,
    auto: false,
    now,
    workspaceId,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: r.error === "in_progress" ? 409 : 400 });
  }
  const verify = await verifyAggregate("invoice", id, workspaceId);
  return NextResponse.json({ ok: true, status: "submitted", billNumber: r.billNumber, target: r.target, verify, seal: r.seal });
}
