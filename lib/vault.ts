import { db, ready } from "./db";
import { id } from "./ids";
import { encryptJSON, decryptJSON } from "./encrypt";
import type { SkillStep } from "./types";

/**
 * Credential vault. A wallet stores per-host secrets once (encrypted at rest);
 * at run time the runner auto-fills a skill's matching input fields from the
 * RUNNER's own vault for that host - so you don't re-enter a password every run.
 * (Full per-provider OAuth connections are a larger follow-on.)
 */
export interface VaultEntryMeta {
  id: string;
  host: string;
  key: string;
  createdAt: number;
}

/** Upsert a credential (owner+host+key is unique). Value stored encrypted. */
export async function setCredential(
  owner: string,
  host: string,
  key: string,
  value: string,
): Promise<void> {
  await ready();
  const h = host.trim().toLowerCase();
  await db.execute({
    sql: `INSERT INTO vault (id, owner, host, key, value, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner, host, key) DO UPDATE SET value = excluded.value`,
    args: [id("vlt"), owner, h, key, encryptJSON(value), Date.now()],
  });
}

/** Metadata only (never the values) for the vault UI. */
export async function listCredentials(owner: string): Promise<VaultEntryMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, host, key, created_at FROM vault WHERE owner = ?
          ORDER BY host, key`,
    args: [owner],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    host: String(x.host),
    key: String(x.key),
    createdAt: Number(x.created_at),
  }));
}

export async function deleteCredential(
  entryId: string,
  owner: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `DELETE FROM vault WHERE id = ? AND owner = ?`,
    args: [entryId, owner],
  });
  return r.rowsAffected > 0;
}

/** Decrypted key→value for an owner+host, used by the runner to fill inputs. */
export async function resolveCredentials(
  owner: string,
  host: string,
): Promise<Record<string, string>> {
  await ready();
  const h = host.trim().toLowerCase();
  if (!h) return {};
  const r = await db.execute({
    sql: `SELECT key, value FROM vault WHERE owner = ? AND host = ?`,
    args: [owner, h],
  });
  const out: Record<string, string> = {};
  for (const row of r.rows) {
    out[String(row.key)] = decryptJSON<string>(
      row.value == null ? null : String(row.value),
      "",
    );
  }
  return out;
}

/** The host a skill primarily operates on (for vault lookup). */
export function primaryHost(allowedHosts: string[], plan: SkillStep[]): string {
  if (allowedHosts[0]) return allowedHosts[0].toLowerCase();
  for (const s of plan) {
    if (s.action === "navigate" && s.target) {
      try {
        return new URL(s.target).hostname.toLowerCase();
      } catch {
        /* not a URL */
      }
    }
  }
  return "";
}
