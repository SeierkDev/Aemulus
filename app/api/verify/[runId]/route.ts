import { NextResponse } from "next/server";
import { verifyReceipt } from "@/lib/receipt";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, unauthenticated receipt verification - returns no private data. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  // Public + fans out to a Solana RPC. The per-IP cap uses X-Forwarded-For, which
  // a caller can spoof to spread requests across buckets — so ALSO enforce a fixed
  // global cap, which no header trick can bypass, to bound total RPC amplification.
  const globalLimited = enforceRateLimit("verify-run:global", 600, 60_000, "Service busy — try again shortly.");
  if (globalLimited) return globalLimited;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const limited = enforceRateLimit(`verify-run:${ip}`, 30, 60_000, "Too many requests");
  if (limited) return limited;
  const { runId } = await params;
  const result = await verifyReceipt(runId);
  return NextResponse.json(result, { status: result.found ? 200 : 404 });
}
