import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { db, ready } from "./db";
import { id } from "./ids";

/**
 * API keys for the public /api/v1 protocol surface. The raw key is shown once
 * at creation; only its sha256 is stored. Keys authenticate as their owner
 * wallet (same identity as a SIWS session), so quota/ownership all still apply.
 */

export interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createApiKey(
  owner: string,
  name: string,
): Promise<{ key: string; meta: ApiKeyMeta }> {
  await ready();
  const raw = `aem_live_${bs58.encode(randomBytes(24))}`;
  const kid = id("key");
  const now = Date.now();
  const prefix = `${raw.slice(0, 16)}…`;
  await db.execute({
    sql: `INSERT INTO api_keys (id, owner, name, key_hash, prefix, created_at, revoked)
          VALUES (?, ?, ?, ?, ?, ?, 0)`,
    args: [kid, owner, name || "API key", hashKey(raw), prefix, now],
  });
  return {
    key: raw,
    meta: { id: kid, name: name || "API key", prefix, createdAt: now, lastUsedAt: null },
  };
}

export async function listApiKeys(owner: string): Promise<ApiKeyMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, name, prefix, created_at, last_used_at FROM api_keys
          WHERE owner = ? AND revoked = 0 ORDER BY created_at DESC`,
    args: [owner],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    prefix: String(x.prefix),
    createdAt: Number(x.created_at),
    lastUsedAt: x.last_used_at == null ? null : Number(x.last_used_at),
  }));
}

export async function revokeApiKey(
  keyId: string,
  owner: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE api_keys SET revoked = 1 WHERE id = ? AND owner = ?`,
    args: [keyId, owner],
  });
  return r.rowsAffected > 0;
}

/** Resolve a raw key to its owner wallet, or null. Updates last_used_at. */
export async function authApiKey(raw: string): Promise<string | null> {
  if (!raw || !raw.startsWith("aem_")) return null;
  await ready();
  const r = await db.execute({
    sql: `SELECT id, owner FROM api_keys WHERE key_hash = ? AND revoked = 0`,
    args: [hashKey(raw)],
  });
  const row = r.rows[0];
  if (!row) return null;
  void db
    .execute({
      sql: `UPDATE api_keys SET last_used_at = ? WHERE id = ?`,
      args: [Date.now(), String(row.id)],
    })
    .catch(() => {});
  return String(row.owner);
}

/** Extract + verify a Bearer API key from a request → owner wallet, or null. */
export async function apiKeyOwner(req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return authApiKey(m[1].trim());
}
