import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bootAt, metricsSnapshot } from "@/lib/metrics";
import { jobCounts } from "@/lib/jobs";
import { gatingEnabled } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe. The PUBLIC body is minimal (ok/db/uptime) so a load
 * balancer can poll it without exposing internal state. The detailed telemetry
 * (throughput/error counters, queue depth, whether gating is on) is recon-useful
 * — an anonymous caller learning gating is off could time an attack — so it's
 * returned ONLY to an ops caller presenting AEMULUS_METRICS_TOKEN. Returns 503 if
 * the database isn't reachable.
 */
export async function GET(req: Request) {
  let dbOk = true;
  try {
    await db.execute("SELECT 1");
  } catch {
    dbOk = false;
  }
  const body: Record<string, unknown> = {
    ok: dbOk,
    db: dbOk ? "ok" : "unreachable",
    uptimeMs: Date.now() - bootAt,
  };

  const opsToken = process.env.AEMULUS_METRICS_TOKEN;
  if (opsToken && req.headers.get("x-metrics-token") === opsToken) {
    if (dbOk) {
      try {
        body.jobs = await jobCounts();
      } catch {
        /* db went away between the ping and here */
      }
    }
    body.gating = gatingEnabled();
    body.metrics = metricsSnapshot();
  }
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
