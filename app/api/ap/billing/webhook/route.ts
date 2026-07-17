import { NextResponse } from "next/server";
import { verifyStripeSignature, applyStripeEvent } from "@/lib/ap-controls/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe webhook: verify the signature over the RAW body, then apply the event
// to the workspace's plan. Returns 200 on success so Stripe stops retrying.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(raw, sig, secret, Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });
  }

  try {
    await applyStripeEvent(JSON.parse(raw), Date.now());
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
