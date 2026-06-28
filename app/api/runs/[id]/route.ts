import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRun } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cheap status poll for the live run view. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  const { id } = await params;
  const run = await getRun(id);
  if (!run || run.owner !== session?.pubkey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ status: run.status, steps: run.steps.length });
}
