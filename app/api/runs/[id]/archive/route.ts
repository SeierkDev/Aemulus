import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRun } from "@/lib/runs";
import { shotsEnabled } from "@/lib/arweave";
import { archiveRunShots, setShotsPublic } from "@/lib/shot-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only: publish this run's screenshots to permanent public storage.
 *
 * Deliberately an explicit action rather than a default. Public verification
 * has always excluded screenshots, and a run's images routinely carry invoices,
 * vendor names and whatever else sat on a logged-in page. Arweave has no
 * delete, so this cannot be undone — turning the flag back off stops future
 * uploads but cannot retract one already made. The response says so rather than
 * leaving the caller to find out.
 */
export async function POST(
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
    // Same answer for "not yours" as for "doesn't exist", so this can't be used
    // to probe which run ids are real.
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { public?: unknown };
  const wantPublic = body.public !== false;

  if (!(await setShotsPublic(id, session.pubkey, wantPublic))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (!wantPublic) {
    return NextResponse.json({
      public: false,
      note: "No further screenshots will be stored. Anything already stored is permanent and cannot be removed.",
    });
  }

  if (!shotsEnabled()) {
    return NextResponse.json({
      public: true,
      stored: 0,
      note: "Marked for archiving. Permanent screenshot storage is not switched on, so nothing has been uploaded yet.",
    });
  }

  const res = await archiveRunShots(id);
  return NextResponse.json({
    public: true,
    ...res,
    note: "Stored permanently. This cannot be undone.",
  });
}
