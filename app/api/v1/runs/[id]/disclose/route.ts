import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { getRun, getRunSalts } from "@/lib/runs";
import { commitmentFields, discloseField } from "@/lib/commitment";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Selective disclosure, reachable from code.
 *
 * The same proof has been available since private receipts shipped, but only at
 * /api/runs/[id]/disclose, which authenticates with a browser session. That put
 * the one feature hardest to hand-roll — a Merkle proof of a single field
 * against an anchored root — behind the one door an SDK cannot open. Anything
 * automated had to drive a signed-in browser to get it, which is not a thing
 * anybody does.
 *
 * Same proof, same owner check, API-key auth. Read scope: this reveals one
 * field of a run to whoever calls it, which is exactly what reading a run does.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  if (!hasScope(auth.scopes, "read")) {
    return NextResponse.json({ error: "API key lacks 'read' scope" }, { status: 403 });
  }

  const { id } = await params;
  const run = await getRun(id);
  // Not-found rather than forbidden for somebody else's run: whether a run id
  // exists is not something an unrelated key should be able to probe.
  if (!run || run.owner !== auth.owner) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (!run.commitmentRoot) {
    return NextResponse.json({ error: "No commitment for this run" }, { status: 404 });
  }

  const field = new URL(req.url).searchParams.get("field") ?? "";
  if (!field) {
    return NextResponse.json({ error: "Pass ?field=" }, { status: 400 });
  }

  try {
    const salts = await getRunSalts(id);
    const disclosure = discloseField(
      commitmentFields(run),
      salts,
      run.commitmentRoot,
      field,
    );
    if (!disclosure) {
      return NextResponse.json({ error: "Unknown field" }, { status: 404 });
    }
    return NextResponse.json({ disclosure: { runId: id, ...disclosure } });
  } catch (e) {
    logError("api/v1/disclose", e, { run: id });
    return NextResponse.json({ error: "Could not build the disclosure" }, { status: 500 });
  }
}
