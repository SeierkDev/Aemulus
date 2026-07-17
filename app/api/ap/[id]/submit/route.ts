import { NextResponse } from "next/server";
import { DEMO_INVOICE_ID, DEMO_FIXTURE, DEMO_ACTOR } from "@/lib/ap-controls/demo";
import { enterInvoice } from "@/lib/ap-controls/qbo-submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Enter the reviewed invoice into QuickBooks and seal the real Bill id into the
// audit stream. The QBO write + idempotency + sealing are all real; the invoice
// fields come from the demo fixture (OCR is not in scope). Mocked auth (one
// hard-coded reviewer), scoped to the demo invoice.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id !== DEMO_INVOICE_ID) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = await enterInvoice({
    invoiceId: id,
    vendorName: DEMO_FIXTURE.vendor,
    docNumber: DEMO_FIXTURE.invoiceNumber,
    txnDate: DEMO_FIXTURE.invoiceDate,
    amount: DEMO_FIXTURE.amount,
    total: DEMO_FIXTURE.amount,
    currency: DEMO_FIXTURE.currency,
    actor: { userId: DEMO_ACTOR.userId, role: DEMO_ACTOR.role },
    now: Date.now(),
  });

  if (!r.ok) {
    const status = r.error === "in_progress" ? 409 : 400;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json({ ok: true, billNumber: r.billNumber, target: r.target, verify: r.verify, seal: r.seal });
}
