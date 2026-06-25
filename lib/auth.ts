import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { env } from "./env";
import type { Tier } from "./solana";

/**
 * Sign-In With Solana (SIWS) + session handling.
 *
 * Flow: client requests a nonce → signs a human-readable message containing it
 * with Phantom → we verify the ed25519 signature against the wallet's public
 * key → issue a session JWT (httpOnly cookie). The wallet pubkey is the identity.
 */

export const SESSION_COOKIE = "mimic_session";
export const NONCE_COOKIE = "mimic_nonce";
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

/** The message the user signs in Phantom. */
export function buildSignInMessage(nonce: string): string {
  return [
    "Mimic — Sign in",
    "",
    "Sign this message to authenticate. This is free and does not authorize any transaction.",
    "",
    `Nonce: ${nonce}`,
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
    const { payload } = await jwtVerify(token, secret());
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

/** Current session from the cookie (server components / route handlers). */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/** Session only if it has access (level ≥ 1); used to guard money routes. */
export async function requireAccess(): Promise<Session | null> {
  const s = await getSession();
  return s && s.level >= 1 ? s : null;
}
