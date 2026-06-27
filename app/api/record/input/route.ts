import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getRecorder, type InputEvent } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forward a user input event from the streamed view to the recorded page. */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const rec = getRecorder(session.pubkey);
  const body = (await req.json().catch(() => ({}))) as {
    event?: InputEvent;
    events?: InputEvent[];
  };
  const events = body.events ?? (body.event ? [body.event] : []);
  for (const ev of events) await rec.dispatchInput(ev);
  return NextResponse.json({ ok: true });
}
