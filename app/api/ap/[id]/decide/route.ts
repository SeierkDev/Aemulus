import { NextResponse } from "next/server";
import { DEMO_INVOICE_ID } from "@/lib/ap-controls/demo";
import { decideInvoice } from "@/lib/ap-controls/decide";
import { getApViewer, viewerActor, viewerEntitlement } from "@/lib/ap-controls/ap-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generic review decision for any workspace invoice (the demo invoice keeps its
// own richer flow). Requires an authenticated viewer.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getApViewer().catch(() => null);
  if (!viewer) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (id === DEMO_INVOICE_ID) return NextResponse.json({ ok: false, error: "Use the walkthrough for this invoice." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; reasonCode?: string; note?: string };
  const now = Date.now();
  const ent = await viewerEntitlement(viewer, now);

  const r = await decideInvoice({
    invoiceId: id,
    workspaceId: viewer.workspaceId,
    actor: viewerActor(viewer),
    action: body.action === "reject" ? "reject" : "approve",
    reasonCode: String(body.reasonCode ?? "").trim(),
    note: body.note ? String(body.note) : undefined,
    canEnter: ent.canEnter,
    now,
  });

  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.httpStatus });
  return NextResponse.json(r);
}
