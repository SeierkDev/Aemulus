import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bootAt, metricsSnapshot } from "@/lib/metrics";
import { jobCounts } from "@/lib/jobs";
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
  let jobs: Record<string, number> = {};
  try {
    await db.execute("SELECT 1");
    jobs = await jobCounts();
  } catch {
    dbOk = false;
  }
  const body = {
    ok: dbOk,
    uptimeMs: Date.now() - bootAt,
    db: dbOk ? "ok" : "unreachable",
    gating: gatingEnabled(),
    jobs, // queue depth by status
    metrics: metricsSnapshot(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
