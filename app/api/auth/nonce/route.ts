import { NextResponse } from "next/server";
import { buildSignInMessage, newNonce, NONCE_COOKIE } from "@/lib/auth";
import { issueNonce } from "@/lib/nonce-store";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function domainFrom(req: Request): string {
  return process.env.AEMULUS_DOMAIN ?? req.headers.get("host") ?? "aemulus";
}

export async function GET(req: Request) {
  const nonce = newNonce();
  // One timestamp, used for BOTH the signed message and the cookie, so verify
  // rebuilds a byte-identical message.
  const issuedMs = Date.now();
  // Persist the nonce server-side so verify can enforce single-use (the cookie
  // only conveys WHICH nonce; the DB row is the source of truth for issue time
  // and consumption).
  await issueNonce(nonce, issuedMs);
  const message = buildSignInMessage(
    nonce,
    domainFrom(req),
    new Date(issuedMs).toISOString(),
  );

  const res = NextResponse.json({ nonce, message });
  // Cookie carries nonce + issue time so verify can rebuild + enforce expiry.
  res.cookies.set(NONCE_COOKIE, `${nonce}|${issuedMs}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 300,
  });
  return res;
}
