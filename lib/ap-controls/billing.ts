import { db } from "../db";
import { id } from "../ids";
import { ensureApEventsSchema } from "./store";

// AP usage metering + limit for the $AEMU tier system. Usage is derived from the
// sealed event log (invoice.submitted events over a rolling 30 days), so it can't
// drift from what actually happened. Access + tiers are governed by the wallet's
// $AEMU balance via viewerEntitlement (see ap-viewer.ts).

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30-day window

export function freeEntryLimit(): number {
  return Number(process.env.AEMULUS_FREE_ENTRY_LIMIT) || 10;
}

export type Plan = "free" | "pro";

export interface Entitlement {
  plan: Plan;
  used: number;
  limit: number | null; // null = unlimited
  canEnter: boolean;
  enforced: boolean;
}

/** Count of invoices entered in this workspace over the rolling period. */
export async function usageThisPeriod(workspaceId: string, now: number): Promise<number> {
  await ensureApEventsSchema();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM ap_events WHERE workspace_id = ? AND event_type = 'invoice.submitted' AND created_at >= ?`,
    args: [workspaceId, now - PERIOD_MS],
  });
  return Number((r.rows[0] as Record<string, unknown>).c);
}

// ── Atomic entry reservation ────────────────────────────────────────────────
// The free-entry limit was a check-then-act (COUNT, compare, then seal on a
// fresh aggregate that never contends), so a concurrent burst could all read
// used<limit and all enter — bypassing the cap. reserveApEntry does the
// count-and-insert in ONE serialized statement (like the run quota), so the
// (limit+1)th concurrent request inserts 0 rows and is refused.
const DDL_RESV = `
  CREATE TABLE IF NOT EXISTS ap_entry_reservations (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ap_resv ON ap_entry_reservations(workspace_id, created_at);`;
let resvReady: Promise<void> | null = null;
function ensureResvSchema(): Promise<void> {
  if (!resvReady) {
    resvReady = db.executeMultiple(DDL_RESV).catch((e) => {
      resvReady = null;
      throw e;
    });
  }
  return resvReady;
}

/** Atomically reserve one entry slot in the rolling window. Returns a reservation
 *  id, or null if the workspace is already at `limit` (over quota). */
export async function reserveApEntry(workspaceId: string, limit: number, now: number): Promise<string | null> {
  await ensureResvSchema();
  const resId = id("apr");
  // Prune rows aged out of the window so the table stays small (doesn't affect the
  // windowed COUNT below).
  await db.execute({ sql: `DELETE FROM ap_entry_reservations WHERE created_at < ?`, args: [now - PERIOD_MS] });
  const r = await db.execute({
    sql: `INSERT INTO ap_entry_reservations (id, workspace_id, created_at)
          SELECT ?, ?, ?
          WHERE (SELECT COUNT(*) FROM ap_entry_reservations WHERE workspace_id = ? AND created_at >= ?) < ?`,
    args: [resId, workspaceId, now, workspaceId, now - PERIOD_MS, limit],
  });
  return r.rowsAffected === 1 ? resId : null;
}

/** Release a reservation whose entry didn't complete (the seal failed), returning
 *  the slot so a transient failure doesn't permanently consume quota. */
export async function releaseApEntry(reservationId: string): Promise<void> {
  await ensureResvSchema();
  await db.execute({ sql: `DELETE FROM ap_entry_reservations WHERE id = ?`, args: [reservationId] });
}
