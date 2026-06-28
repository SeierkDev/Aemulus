import { NextResponse } from "next/server";
import { buildSignInMessage, newNonce, NONCE_COOKIE } from "@/lib/auth";
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
