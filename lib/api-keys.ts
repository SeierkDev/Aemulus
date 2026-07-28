import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { db, ready } from "./db";
import { id } from "./ids";

/**
 * API keys for the public /api/v1 protocol surface. The raw key is shown once
 * at creation; only its sha256 is stored. Keys authenticate as their owner
 * wallet (same identity as a SIWS session), so quota/ownership all still apply.
 */

export type Scope = "read" | "run";
const ALL_SCOPES: Scope[] = ["read", "run"];

export interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Normalize requested scopes → a valid set that always includes "read". */
function cleanScopes(scopes?: string[]): Scope[] {
  const set = new Set<Scope>(["read"]);
  for (const s of scopes ?? ALL_SCOPES) {
    if (s === "run") set.add("run");
  }
  return [...set];
}

/** Does a key's scope set permit `need`? "run" implies "read". */
export function hasScope(scopes: Scope[], need: Scope): boolean {
  if (need === "read") return scopes.includes("read") || scopes.includes("run");
  return scopes.includes(need);
}

function parseScopes(raw: unknown): Scope[] {
  const parts = String(raw ?? "read,run").split(",");
  const set = new Set<Scope>();
  for (const p of parts) if (p === "read" || p === "run") set.add(p);
  return set.size ? [...set] : ["read"];
}

/** Per-owner active (non-revoked) API-key cap — bounds api_keys row growth. */
export const MAX_API_KEYS_PER_OWNER = 25;

/** Count of a wallet's active (non-revoked) API keys — for the create cap. */
export async function countActiveApiKeys(owner: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM api_keys WHERE owner = ? AND revoked = 0`,
    args: [owner],
  });
  return Number((r.rows[0] as Record<string, unknown>).c);
}

export async function createApiKey(
  owner: string,
  name: string,
  scopes?: string[],
): Promise<{ key: string; meta: ApiKeyMeta }> {
  await ready();
  const raw = `aem_live_${bs58.encode(randomBytes(24))}`;
  const kid = id("key");
  const now = Date.now();
  const prefix = `${raw.slice(0, 16)}…`;
  const scope = cleanScopes(scopes);
  await db.execute({
    sql: `INSERT INTO api_keys (id, owner, name, key_hash, prefix, scopes, created_at, revoked)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [kid, owner, name || "API key", hashKey(raw), prefix, scope.join(","), now],
  });
  return {
    key: raw,
    meta: {
      id: kid,
      name: name || "API key",
      prefix,
      scopes: scope,
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

export async function listApiKeys(owner: string): Promise<ApiKeyMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, name, prefix, scopes, created_at, last_used_at FROM api_keys
          WHERE owner = ? AND revoked = 0 ORDER BY created_at DESC`,
    args: [owner],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    prefix: String(x.prefix),
    scopes: parseScopes(x.scopes),
    createdAt: Number(x.created_at),
    lastUsedAt: x.last_used_at == null ? null : Number(x.last_used_at),
  }));
}

export async function revokeApiKey(
  keyId: string,
  owner: string,
): Promise<boolean> {
  await ready();
  // Hard-DELETE, not a soft `revoked=1` flag: nothing ever reads a revoked row (the
  // auth lookup, the listing, and the per-owner cap all filter `revoked=0`), so a
  // soft flag was pure dead weight that a create→revoke→create loop could grow without
  // bound while the active-count cap stayed satisfied. Deleting keeps the table ≤ the
  // active cap per owner. A revoked key still stops authenticating (its row is gone).
  const r = await db.execute({
    sql: `DELETE FROM api_keys WHERE id = ? AND owner = ?`,
    args: [keyId, owner],
  });
  return r.rowsAffected > 0;
}

export interface ApiKeyAuth {
  owner: string;
  scopes: Scope[];
}

/** Resolve a raw key to its owner + scopes, or null. Updates last_used_at. */
export async function authApiKey(raw: string): Promise<ApiKeyAuth | null> {
  if (!raw || !raw.startsWith("aem_")) return null;
  await ready();
  const r = await db.execute({
    sql: `SELECT id, owner, scopes FROM api_keys WHERE key_hash = ? AND revoked = 0`,
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
  return { owner: String(row.owner), scopes: parseScopes(row.scopes) };
}

/** Extract + verify a Bearer API key → { owner, scopes }, or null. */
export async function apiKeyAuth(req: Request): Promise<ApiKeyAuth | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return authApiKey(m[1].trim());
}

/** Owner-only convenience (back-compat) - scopes ignored. */
export async function apiKeyOwner(req: Request): Promise<string | null> {
  return (await apiKeyAuth(req))?.owner ?? null;
}
