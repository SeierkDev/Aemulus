import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEMO_INVOICE_ID } from "@/lib/ap-controls/demo";
import { ensureApEventsSchema } from "@/lib/ap-controls/store";
import { deleteLedgerBill } from "@/lib/ap-controls/ledger";
import { getApViewer } from "@/lib/ap-controls/ap-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reset ONLY the caller's own seeded demo-invoice stream so the walkthrough can be
// replayed. Requires auth and is scoped to the caller's workspace.
export async function POST() {
  const viewer = await getApViewer().catch(() => null);
  if (!viewer) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  await ensureApEventsSchema();
  // Delete the sealed events AND the keyed head anchor AND any ledger bill for this
  // invoice. Dropping only the events would leave the head anchor pinned at the old
  // seq_count (the head upsert only ever advances, never shrinks — store.ts), so the
  // re-seeded stream would fail verifyAggregate as "truncated_tail"/"missing_head"
  // and the replayed demo would falsely report itself tampered. The stale ledger row
  // would likewise resurrect the old bill number on re-entry (INSERT OR IGNORE).
  await db.execute({
    sql: `DELETE FROM ap_events WHERE workspace_id = ? AND aggregate_type = 'invoice' AND aggregate_id = ?`,
    args: [viewer.workspaceId, DEMO_INVOICE_ID],
  });
  await db.execute({
    sql: `DELETE FROM ap_aggregate_head WHERE workspace_id = ? AND aggregate_type = 'invoice' AND aggregate_id = ?`,
    args: [viewer.workspaceId, DEMO_INVOICE_ID],
  });
  await deleteLedgerBill(DEMO_INVOICE_ID, viewer.workspaceId);
  return NextResponse.json({ ok: true });
}
