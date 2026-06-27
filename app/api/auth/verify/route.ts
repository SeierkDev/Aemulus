import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  buildSignInMessage,
  createSessionToken,
  NONCE_COOKIE,
  SESSION_COOKIE,
  verifyWalletSignature,
  type Session,
} from "@/lib/auth";
import { computeTier, getMimicBalance } from "@/lib/solana";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { pubkey, signature } = (await req.json().catch(() => ({}))) as {
    pubkey?: string;
    signature?: string;
  };
  if (!pubkey || !signature) {
    return NextResponse.json(
      { error: "pubkey and signature are required" },
      { status: 400 },
    );
  }

  const cookie = (await cookies()).get(NONCE_COOKIE)?.value;
  const [nonce, issuedStr] = (cookie ?? "").split("|");
  const issuedAt = Number(issuedStr);
  if (!nonce || !Number.isFinite(issuedAt)) {
    return NextResponse.json(
      { error: "Missing nonce — request a new one." },
      { status: 400 },
    );
  }
  if (Date.now() - issuedAt > 5 * 60 * 1000) {
    return NextResponse.json(
      { error: "Sign-in challenge expired — request a new one." },
      { status: 400 },
    );
  }

  const domain = process.env.MIMIC_DOMAIN ?? req.headers.get("host") ?? "mimic";
  const message = buildSignInMessage(
    nonce,
    domain,
    new Date(issuedAt).toISOString(),
  );
  if (!verifyWalletSignature(message, signature, pubkey)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const balance = await getMimicBalance(pubkey);
  const tier = computeTier(balance);
  const session: Session = {
    pubkey,
    tier: tier.name,
    level: tier.level,
    balance,
  };

  const token = await createSessionToken(session);
  const res = NextResponse.json({ session });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  res.cookies.delete(NONCE_COOKIE);
  return res;
}
