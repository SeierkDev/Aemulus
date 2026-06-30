import { db, ready } from "./db";

/**
 * Idempotency for mutating POSTs. A client may send an `Idempotency-Key` header;
 * if it does, the same (owner, scope, key) triple executes the operation at most
 * once - a retry (network blip, double-click, SDK retry) returns the ORIGINAL
 * response instead of starting a second run or triggering a second payout.
 *
 * Reserve-first: we INSERT the key (PK on owner+scope+key) before running the
 * handler, so two concurrent requests with the same key can't both execute -
 * the loser sees the reservation and returns the stored result (or 409 if the
 * winner is still in flight). On handler failure the reservation is released so
 * a genuine retry can proceed.
 */
export interface IdemResult {
  status: number;
  body: unknown;
}

const MAX_KEY_LEN = 255;

export async function withIdempotency(
  owner: string,
  scope: string,
  key: string | null,
  handler: () => Promise<IdemResult>,
): Promise<IdemResult> {
  // No (or unusable) key → no idempotency, just run it.
  if (!key || key.length > MAX_KEY_LEN) return handler();
  await ready();

  let reserved = false;
  try {
    await db.execute({
      sql: `INSERT INTO idempotency_keys (owner, scope, key, status, body, created_at)
            VALUES (?, ?, ?, NULL, NULL, ?)`,
      args: [owner, scope, key, Date.now()],
    });
    reserved = true;
  } catch {
    // PK conflict - a prior request already claimed this key.
  }

  if (!reserved) {
    const r = await db.execute({
      sql: `SELECT status, body FROM idempotency_keys WHERE owner = ? AND scope = ? AND key = ?`,
      args: [owner, scope, key],
    });
    const row = r.rows[0];
    if (row && row.status != null) {
      let body: unknown = null;
      try {
        body = JSON.parse(String(row.body ?? "null"));
      } catch {
        body = String(row.body ?? ""); // tolerate a non-JSON stored body
      }
      return { status: Number(row.status), body };
    }
    // Reserved but no response yet → the original request is still in flight.
    return {
      status: 409,
      body: { error: "A request with this Idempotency-Key is already in progress." },
    };
  }

  try {
    const res = await handler();
    await db.execute({
      sql: `UPDATE idempotency_keys SET status = ?, body = ? WHERE owner = ? AND scope = ? AND key = ?`,
      args: [res.status, JSON.stringify(res.body), owner, scope, key],
    });
    return res;
  } catch (e) {
    // Release the reservation so the client can safely retry.
    await db
      .execute({
        sql: `DELETE FROM idempotency_keys WHERE owner = ? AND scope = ? AND key = ?`,
        args: [owner, scope, key],
      })
      .catch(() => {});
    throw e;
  }
}
