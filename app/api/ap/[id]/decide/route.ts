import { NextResponse } from "next/server";
import { DEMO_INVOICE_ID } from "@/lib/ap-controls/demo";
import { decideInvoice } from "@/lib/ap-controls/decide";
import { getApViewer, viewerActor, viewerEntitlement } from "@/lib/ap-controls/ap-viewer";
import { reserveApEntry, releaseApEntry } from "@/lib/ap-controls/billing";

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
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ ok: false, error: "Action must be approve or reject." }, { status: 400 });
  }
  const now = Date.now();
  const ent = await viewerEntitlement(viewer, now);

  // Approving enters the invoice, so it consumes a quota slot — reserve it
  // atomically (a reject never enters, so it needs no slot). canEnter reflects the
  // reservation; the slot is released below if the entry didn't actually happen.
  const capped = ent.enforced && ent.limit !== null;
  let reservation: string | null = null;
  if (body.action === "approve" && capped) {
    reservation = await reserveApEntry(viewer.workspaceId, ent.limit as number, now);
  }
  const canEnter = capped ? reservation !== null : ent.canEnter;

  const r = await decideInvoice({
    invoiceId: id,
    workspaceId: viewer.workspaceId,
    actor: viewerActor(viewer),
    action: body.action,
    reasonCode: String(body.reasonCode ?? "").trim(),
    note: body.note ? String(body.note) : undefined,
    canEnter,
    now,
  });

  // Return the slot unless an entry actually sealed (rejected, errored, or refused).
  if (reservation && !(r.ok && r.status === "submitted")) {
    await releaseApEntry(reservation);
  }

  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.httpStatus });
  return NextResponse.json(r);
}
