import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRun, getRunSalts } from "@/lib/runs";
import { commitmentFields, discloseField } from "@/lib/commitment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only: produce a selective-disclosure proof for one field of a run. The
 * returned bundle proves this field's value against the run's committed (and
 * on-chain anchored) root, without revealing any other field. Share it; anyone
 * can verify it at POST /api/disclosures/verify.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const run = await getRun(id);
  if (!run || run.owner !== session.pubkey) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (!run.commitmentRoot) {
    return NextResponse.json({ error: "No commitment for this run" }, { status: 404 });
  }
  const field = new URL(req.url).searchParams.get("field") ?? "";
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
  // Bind the bundle to the run: the verifier requires bundle.root === the run's
  // committed root, so a proof can't be re-based onto an attacker-chosen tree.
  return NextResponse.json({ disclosure: { runId: id, ...disclosure } });
}
