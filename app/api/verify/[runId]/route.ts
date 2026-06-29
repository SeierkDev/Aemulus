import { NextResponse } from "next/server";
import { verifyReceipt } from "@/lib/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, unauthenticated receipt verification - returns no private data. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const result = await verifyReceipt(runId);
  return NextResponse.json(result, { status: result.found ? 200 : 404 });
}
