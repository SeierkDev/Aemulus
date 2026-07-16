import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEMO_INVOICE_ID } from "@/lib/ap-controls/demo";
import { ensureApEventsSchema } from "@/lib/ap-controls/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Demo-only: wipe the seeded invoice's stream so the walkthrough can be replayed.
export async function POST() {
  await ensureApEventsSchema();
  await db.execute({
    sql: `DELETE FROM ap_events WHERE aggregate_type = 'invoice' AND aggregate_id = ?`,
    args: [DEMO_INVOICE_ID],
  });
  return NextResponse.json({ ok: true });
}
