import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { getRun } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public API: fetch a run's status, result, and extracted output. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  if (!hasScope(auth.scopes, "read")) {
    return NextResponse.json({ error: "API key lacks 'read' scope" }, { status: 403 });
  }
  const owner = auth.owner;
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
    // What the run knows about itself. All of it already existed and none of it
    // was reachable from code: the version executed, whether the goal was
    // confirmed, the isolation policy it ran under, its AgenC constraint hash,
    // and how many steps the agent had to repair. A caller deciding whether to
    // trust a result needs these more than it needs the result.
    skillVersion: run.skillVersion,
    outcomeStatus: run.outcomeStatus,
    outcomeReason: run.outcomeReason,
    sandbox: run.sandbox,
    agencHash: run.agencHash,
    commitmentRoot: run.commitmentRoot,
    repairedSteps: run.steps.filter((s) => s.repaired).length,
  });
}
