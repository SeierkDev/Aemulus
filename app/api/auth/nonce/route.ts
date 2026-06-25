import { NextResponse } from "next/server";
import { buildSignInMessage, newNonce, NONCE_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const nonce = newNonce();
  const res = NextResponse.json({ nonce, message: buildSignInMessage(nonce) });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 300,
  });
  return res;
}
