import { db } from "../db";
import { id } from "../ids";
import { ensureApEventsSchema } from "./store";
import { DEMO_INVOICE_ID } from "./demo";

// AP usage metering + limit for the $AEMU tier system. Usage is derived from the
// sealed event log (invoice.submitted events over a rolling 30 days), so it can't
// drift from what actually happened. Access + tiers are governed by the wallet's
// $AEMU balance via viewerEntitlement (see ap-viewer.ts).

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30-day window

export function freeEntryLimit(): number {
  // Honor an explicit 0 (free tier gets NO free entries) — `Number(x) || 10` would
  // turn a deliberate 0 into 10, granting 10 free metered entries per workspace.
  const n = Number(process.env.AEMULUS_FREE_ENTRY_LIMIT);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}

export type Plan = "free" | "pro";

export interface Entitlement {
  plan: Plan;
  used: number;
  limit: number | null; // null = unlimited
  canEnter: boolean;
  enforced: boolean;
}

/** Count of invoices entered in this workspace over the rolling period. Excludes the
 *  demo walkthrough invoice: the demo `submit` route seals an invoice.submitted
 *  WITHOUT taking an ap_entry_reservations slot, so counting it here would let a
 *  capped workspace enter limit+1 real invoices (the two counters must agree that the
 *  demo is free). */
export async function usageThisPeriod(workspaceId: string, now: number): Promise<number> {
  await ensureApEventsSchema();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM ap_events WHERE workspace_id = ? AND event_type = 'invoice.submitted' AND aggregate_id <> ? AND created_at >= ?`,
    args: [workspaceId, DEMO_INVOICE_ID, now - PERIOD_MS],
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
 *  id, or null if the workspace is already at `limit` (over quota).
 *
 *  The reservation is a TRANSIENT concurrency hold, released once the entry's
 *  invoice.submitted event seals (or the entry fails). The durable usage of record is
 *  the sealed event log itself — so the gate counts the real submitted events in the
 *  window (all entries, enforced or not, minus the free demo) PLUS the in-flight
 *  reservations. Counting reservations ALONE was wrong: entries made while the
 *  workspace was unlimited (pre-launch, or a higher tier) created events but no
 *  reservation, so a later gating/tier change reset the effective counter to zero and
 *  let the cap be exceeded by the historical entry count. Counting the events fixes
 *  that; the in-flight reservations close the check-then-act race for concurrent
 *  entries whose events haven't sealed yet. One serialized INSERT…WHERE = atomic. */
export async function reserveApEntry(workspaceId: string, limit: number, now: number): Promise<string | null> {
  await ensureApEventsSchema();
  await ensureResvSchema();
  const resId = id("apr");
  // Prune rows aged out of the window so the table stays small (doesn't affect the
  // windowed COUNT below).
  await db.execute({ sql: `DELETE FROM ap_entry_reservations WHERE created_at < ?`, args: [now - PERIOD_MS] });
  const r = await db.execute({
    sql: `INSERT INTO ap_entry_reservations (id, workspace_id, created_at)
          SELECT ?, ?, ?
          WHERE (
            (SELECT COUNT(*) FROM ap_events
               WHERE workspace_id = ? AND event_type = 'invoice.submitted'
                 AND aggregate_id <> ? AND created_at >= ?)
            + (SELECT COUNT(*) FROM ap_entry_reservations WHERE workspace_id = ? AND created_at >= ?)
          ) < ?`,
    args: [resId, workspaceId, now, workspaceId, DEMO_INVOICE_ID, now - PERIOD_MS, workspaceId, now - PERIOD_MS, limit],
  });
  return r.rowsAffected === 1 ? resId : null;
}

/** Release a reservation (the transient hold) once its entry has sealed or failed —
 *  the sealed invoice.submitted event is the durable usage record, so the hold is no
 *  longer needed. Always called after an entry attempt, success or failure. */
export async function releaseApEntry(reservationId: string): Promise<void> {
  await ensureResvSchema();
  await db.execute({ sql: `DELETE FROM ap_entry_reservations WHERE id = ?`, args: [reservationId] });
}
