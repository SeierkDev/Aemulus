import { cookies } from "next/headers";
import {
  verifySessionToken,
  type Session,
} from "./siws";

/**
 * Cookie-bound session layer (Next.js). Pure SIWS crypto + token helpers live
 * in siws.ts; this file adds the request-scoped cookie reads and re-exports the
 * rest so existing `@/lib/auth` importers are unaffected.
 */

export {
  newNonce,
  buildSignInMessage,
  verifyWalletSignature,
  createSessionToken,
  verifySessionToken,
  type Session,
} from "./siws";

export const SESSION_COOKIE = "aem_session";
export const NONCE_COOKIE = "aem_nonce";

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
