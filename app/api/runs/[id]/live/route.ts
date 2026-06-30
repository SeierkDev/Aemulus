import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRun } from "@/lib/runs";
import { liveFrame, liveInput, resumeLive } from "@/lib/live";
import { LiveInputSchema } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerOf(id: string, pubkey: string | undefined) {
  if (!pubkey) return false;
  const run = await getRun(id);
  return !!run && run.owner === pubkey;
}

/** Current screencast frame for the live takeover (owner only). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!(await ownerOf(id, session?.pubkey))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json(liveFrame(id));
}

/** Drive the live page, or resume the run. Body: { resume } | { input }. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!(await ownerOf(id, session?.pubkey))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (body?.resume) {
    return NextResponse.json({ ok: resumeLive(id) });
  }
  if (body?.input) {
    const parsed = LiveInputSchema.safeParse(body.input);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input event" }, { status: 400 });
    }
    await liveInput(id, parsed.data);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
}
