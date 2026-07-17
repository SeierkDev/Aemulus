import { NextResponse } from "next/server";
import { getApSession } from "@/lib/ap-controls/ap-session";
import { billingConfigured } from "@/lib/ap-controls/billing";
import { createCheckoutSession } from "@/lib/ap-controls/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getApSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (!billingConfigured()) return NextResponse.json({ ok: false, error: "Billing isn’t set up." }, { status: 503 });

  try {
    const url = await createCheckoutSession({
      workspaceId: session.workspaceId,
      email: session.email,
      origin: new URL(req.url).origin,
    });
    return NextResponse.json({ ok: true, url });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn’t start checkout." }, { status: 502 });
  }
}
