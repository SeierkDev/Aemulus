import { NextResponse } from "next/server";
import { apiKeyOwner } from "@/lib/api-keys";
import { getRun } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public API: fetch a run's status, result, and extracted output. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await apiKeyOwner(req);
  if (!owner) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  const { id } = await params;
  const run = await getRun(id);
  if (!run || run.owner !== owner) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: run.id,
    skillId: run.skillId,
    status: run.status,
    result: run.result,
    output: run.output,
    receiptHash: run.receiptHash,
    steps: run.steps.length,
    createdAt: run.createdAt,
  });
}
