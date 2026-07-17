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
import { computeTier, getAemulusBalance } from "@/lib/solana";
import { consumeNonce } from "@/lib/nonce-store";
import { readJson, VerifyBody } from "@/lib/validate";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await readJson(req, VerifyBody);
  if (!parsed.ok) return parsed.res;
  const { pubkey, signature } = parsed.data;

  const cookie = (await cookies()).get(NONCE_COOKIE)?.value;
  const [nonce] = (cookie ?? "").split("|");
  // Atomically consume the nonce (single-use + expiry) against the server store,
  // NOT the client cookie's timestamp - a replayed request finds the nonce gone.
  const issuedAt = await consumeNonce(nonce, Date.now());
  if (issuedAt == null) {
    return NextResponse.json(
      { error: "Sign-in challenge missing, expired, or already used - request a new one." },
      { status: 400 },
    );
  }

  const domain = process.env.AEMULUS_DOMAIN ?? req.headers.get("host") ?? "aemulus";
  const message = buildSignInMessage(
    nonce,
    domain,
    new Date(issuedAt).toISOString(),
  );
  if (!verifyWalletSignature(message, signature, pubkey)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const balance = await getAemulusBalance(pubkey);
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
