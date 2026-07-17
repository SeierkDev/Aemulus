import { db, ready } from "./db";

/**
 * Server-side single-use nonce store for Sign-In-With-Solana.
 *
 * The nonce is issued (persisted) on GET /auth/nonce and atomically consumed on
 * POST /auth/verify. Without this, a nonce lived only in a client cookie and was
 * "consumed" by a client-side cookie delete - so anyone who captured one valid
 * verify request (its cookie + {pubkey, signature} body) could replay it within
 * the TTL to mint fresh 24h sessions. Persisting + atomically deleting the nonce
 * makes every challenge genuinely single-use.
 */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** Record an issued nonce and opportunistically GC expired ones. */
export async function issueNonce(nonce: string, issuedMs: number): Promise<void> {
  await ready();
  // Keep the table small: drop anything older than the TTL. Cheap, and a nonce
  // is never valid past it anyway.
  await db.execute({
    sql: `DELETE FROM auth_nonces WHERE issued_at < ?`,
    args: [issuedMs - NONCE_TTL_MS],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO auth_nonces (nonce, issued_at) VALUES (?, ?)`,
    args: [nonce, issuedMs],
  });
}

/**
 * Atomically consume a nonce. Returns its issued_at when the nonce existed,
 * was unused, and is within the TTL; otherwise null (unknown, already used, or
 * expired). The DELETE ... RETURNING is a single serialized statement, so a
 * replay - or two concurrent verifies of the same nonce - can succeed at most
 * once; every later attempt gets no row back.
 */
export async function consumeNonce(nonce: string, now: number): Promise<number | null> {
  await ready();
  if (!nonce) return null;
  const r = await db.execute({
    sql: `DELETE FROM auth_nonces WHERE nonce = ? RETURNING issued_at`,
    args: [nonce],
  });
  const row = r.rows[0];
  if (!row) return null; // unknown or already consumed
  const issuedAt = Number(row.issued_at);
  if (!Number.isFinite(issuedAt) || now - issuedAt > NONCE_TTL_MS) return null; // expired
  return issuedAt;
}
