import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { authorizeUrl, newOauthState, qboOauthConfigured } from "@/lib/qbo/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const QBO_STATE_COOKIE = "qbo_oauth_state";

// Start the QuickBooks OAuth flow: set a CSRF state cookie and redirect to Intuit.
export async function GET() {
  if (!qboOauthConfigured()) {
    return NextResponse.json({ error: "QuickBooks is not configured." }, { status: 503 });
  }
  const state = newOauthState();
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(QBO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 600,
  });
  return res;
}
