import { NextResponse } from "next/server";
import { intakeEnter } from "@/lib/ap-controls/intake";
import { getApSession } from "@/lib/ap-controls/ap-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Confirm the (possibly edited) extracted fields and enter the invoice: seals
// provenance + enters via QuickBooks/ledger. Returns the real bill + verification.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Amount must be a positive number." }, { status: 400 });
  }

  const fields = {
    vendor: String(body.vendor ?? ""),
    invoiceNumber: String(body.invoiceNumber ?? ""),
    invoiceDate: String(body.invoiceDate ?? ""),
    amount,
    currency: String(body.currency ?? "USD"),
  };

  const session = await getApSession().catch(() => null);
  const actor = session ? { userId: session.userId, role: "clerk" } : undefined;
  const r = await intakeEnter(fields, "upload", Date.now(), actor, session?.workspaceId);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: r.error === "in_progress" ? 409 : 400 });
  }
  return NextResponse.json({
    ok: true,
    invoiceId: r.invoiceId,
    billNumber: r.billNumber,
    target: r.target,
    verify: r.verify,
    seal: r.seal,
  });
}
