import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { db, ready } from "./db";
import { id } from "./ids";

/**
 * Inbound run triggers: a per-skill signed URL that starts a run when POSTed to.
 * Turns scheduled-only automation into event-driven ("run when my system says
 * so"). The token in the URL is the credential; the trigger enqueues a run via
 * the durable job queue exactly like any other run.
 */
export interface TriggerMeta {
  id: string;
  skillId: string;
  token: string;
  fireCount: number;
  lastFiredAt: number | null;
  createdAt: number;
}

export interface TriggerResolved {
  id: string;
  owner: string;
  skillId: string;
}

export async function createTrigger(
  owner: string,
  skillId: string,
): Promise<TriggerMeta> {
  await ready();
  const tid = id("trg");
  const token = `trg_${bs58.encode(randomBytes(24))}`;
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO triggers (id, owner, skill_id, token, active, fire_count, created_at)
          VALUES (?, ?, ?, ?, 1, 0, ?)`,
    args: [tid, owner, skillId, token, now],
  });
  return { id: tid, skillId, token, fireCount: 0, lastFiredAt: null, createdAt: now };
}

export async function listTriggers(
  owner: string,
  skillId: string,
): Promise<TriggerMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, skill_id, token, fire_count, last_fired_at, created_at
          FROM triggers WHERE owner = ? AND skill_id = ? AND active = 1
          ORDER BY created_at DESC`,
    args: [owner, skillId],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    skillId: String(x.skill_id),
    token: String(x.token),
    fireCount: Number(x.fire_count ?? 0),
    lastFiredAt: x.last_fired_at == null ? null : Number(x.last_fired_at),
    createdAt: Number(x.created_at),
  }));
}

/** Resolve a token to its owner + skill (active only), or null. */
export async function resolveTrigger(token: string): Promise<TriggerResolved | null> {
  if (!token || !token.startsWith("trg_")) return null;
  await ready();
  const r = await db.execute({
    sql: `SELECT id, owner, skill_id FROM triggers WHERE token = ? AND active = 1`,
    args: [token],
  });
  const row = r.rows[0];
  if (!row) return null;
  return { id: String(row.id), owner: String(row.owner), skillId: String(row.skill_id) };
}

export async function recordTriggerFire(triggerId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = ? WHERE id = ?`,
    args: [Date.now(), triggerId],
  });
}

export async function deleteTrigger(
  triggerId: string,
  owner: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `DELETE FROM triggers WHERE id = ? AND owner = ?`,
    args: [triggerId, owner],
  });
  return r.rowsAffected > 0;
}
