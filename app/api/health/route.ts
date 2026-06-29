import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bootAt, metricsSnapshot } from "@/lib/metrics";
import { gatingEnabled } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe + in-process counters. Public and unauthenticated
 * (returns no private data) so a load balancer / uptime monitor can poll it.
 * Returns 503 if the database isn't reachable.
 */
export async function GET() {
  let dbOk = true;
  try {
    await db.execute("SELECT 1");
  } catch {
    dbOk = false;
  }
  const body = {
    ok: dbOk,
    uptimeMs: Date.now() - bootAt,
    db: dbOk ? "ok" : "unreachable",
    gating: gatingEnabled(),
    metrics: metricsSnapshot(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
