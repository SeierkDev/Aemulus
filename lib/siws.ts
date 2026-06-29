import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { env } from "./env";
import type { Tier } from "./solana";

/**
 * Pure Sign-In With Solana crypto + session tokens - no Next.js / cookie
 * coupling, so it's unit-testable in isolation. The cookie-bound layer
 * (getSession / requireAccess) lives in auth.ts and re-exports these.
 */

const TTL_SECONDS = 60 * 60 * 24; // 1 day

export interface Session {
  pubkey: string;
  tier: Tier["name"];
  level: number;
  balance: number;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

export function newNonce(): string {
  return randomUUID().replace(/-/g, "");
}

/** The message the user signs in Phantom (SIWS-style: domain + nonce + time). */
export function buildSignInMessage(
  nonce: string,
  domain = "aemulus",
  issuedAt = "",
): string {
  return [
    `${domain} wants you to sign in with your Solana account.`,
    "",
    "Aemulus - Sign in. This is free and authorizes no transaction.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/** Verify an ed25519 signature (base58) over `message` by `pubkey` (base58). */
export function verifyWalletSignature(
  message: string,
  signatureB58: string,
  pubkeyB58: string,
): boolean {
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signatureB58),
      bs58.decode(pubkeyB58),
    );
  } catch {
    return false;
  }
}

export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySessionToken(
  token: string,
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    return {
      pubkey: String(payload.pubkey),
      tier: payload.tier as Tier["name"],
      level: Number(payload.level),
      balance: Number(payload.balance),
    };
  } catch {
    return null;
  }
}
