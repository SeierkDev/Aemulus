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
  // Public + fans out to a Solana RPC — rate-limit so it can't be used to amplify load.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const limited = enforceRateLimit(`verify-run:${ip}`, 30, 60_000, "Too many requests");
  if (limited) return limited;
  const { runId } = await params;
  const result = await verifyReceipt(runId);
  return NextResponse.json(result, { status: result.found ? 200 : 404 });
}
