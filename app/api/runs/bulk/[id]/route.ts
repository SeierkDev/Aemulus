import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBulkRun, listRunsByBulk } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cheap progress poll for the live bulk view. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  const { id } = await params;
  const bulk = await getBulkRun(id);
  if (!bulk || bulk.owner !== session?.pubkey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const runs = await listRunsByBulk(id);
  const terminal = new Set(["completed", "needs_review", "failed"]);
  const done = runs.filter((r) => terminal.has(r.status)).length;
  return NextResponse.json({ total: bulk.total, done, count: runs.length });
}
