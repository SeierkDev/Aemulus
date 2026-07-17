import { db } from "../db";
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
