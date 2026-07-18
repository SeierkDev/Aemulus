import { NextResponse } from "next/server";
import { intakeEnter } from "@/lib/ap-controls/intake";
import { normalizeExtracted } from "@/lib/ap-controls/extract";
import { getApViewer, viewerActor, viewerEntitlement } from "@/lib/ap-controls/ap-viewer";
import { reserveApEntry, releaseApEntry } from "@/lib/ap-controls/billing";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A single invoice above this is almost certainly a parse/precision error (and
// beyond it JS loses integer cents); reject rather than seal a bogus figure.
const MAX_ENTER_AMOUNT = 1_000_000_000_000; // 1 trillion

// Confirm the (possibly edited) extracted fields and enter the invoice: seals
// provenance + enters via QuickBooks/ledger. Returns the real bill + verification.
export async function POST(req: Request) {
  const viewer = await getApViewer().catch(() => null);
  if (!viewer) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  // Throttle entries per workspace (the entry path needs no prior upload, so an
  // unmetered burst could hammer the seal store / race the quota).
  const limited = enforceRateLimit(`ap-enter:${viewer.workspaceId}`, 20, 60_000, "Too many entries");
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // Normalize the (client-editable) fields at the seal boundary exactly like the
  // extraction path does: round the amount to 2dp, validate the date, and coerce
  // the currency to a 3-letter code — so a client can't seal an unrounded amount
  // or a bogus currency like "dollars".
  const norm = normalizeExtracted({
    vendor: body.vendor as string,
    invoiceNumber: body.invoiceNumber as string,
    invoiceDate: body.invoiceDate as string,
    amount: Number(body.amount),
    currency: body.currency as string,
  });
  if (!(norm.amount > 0)) {
    return NextResponse.json({ ok: false, error: "Amount must be a positive number." }, { status: 400 });
  }
  if (norm.amount > MAX_ENTER_AMOUNT) {
    return NextResponse.json({ ok: false, error: "Amount is implausibly large — check the invoice." }, { status: 400 });
  }

  const fields = {
    vendor: norm.vendor,
    invoiceNumber: norm.invoiceNumber,
    invoiceDate: norm.invoiceDate,
    amount: norm.amount,
    currency: norm.currency,
  };

  // Atomically RESERVE a quota slot before entering, so a concurrent burst can't
  // race past a soft used<limit check. Only for a capped tier; unlimited/pre-launch
  // needs no reservation. Released below if the entry doesn't complete.
  const now = Date.now();
  const ent = await viewerEntitlement(viewer, now);
  let reservation: string | null = null;
  if (ent.enforced && ent.limit !== null) {
    reservation = await reserveApEntry(viewer.workspaceId, ent.limit, now);
    if (!reservation) {
      return NextResponse.json({ ok: false, error: "limit_reached" }, { status: 400 });
    }
  }
  const r = await intakeEnter(fields, "upload", now, viewerActor(viewer), viewer.workspaceId);
  if (!r.ok) {
    if (reservation) await releaseApEntry(reservation); // entry failed → return the slot
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
