import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEMO_INVOICE_ID } from "@/lib/ap-controls/demo";
import { ensureApEventsSchema } from "@/lib/ap-controls/store";
import { getApViewer } from "@/lib/ap-controls/ap-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reset ONLY the caller's own seeded demo-invoice stream so the walkthrough can be
// replayed. Requires auth and is scoped to the caller's workspace.
export async function POST() {
  const viewer = await getApViewer().catch(() => null);
  if (!viewer) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  await ensureApEventsSchema();
  await db.execute({
    sql: `DELETE FROM ap_events WHERE workspace_id = ? AND aggregate_type = 'invoice' AND aggregate_id = ?`,
    args: [viewer.workspaceId, DEMO_INVOICE_ID],
  });
  return NextResponse.json({ ok: true });
}
