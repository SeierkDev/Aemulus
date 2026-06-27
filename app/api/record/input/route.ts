import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { recorder, type InputEvent } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forward a user input event from the streamed view to the recorded page. */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const snap = recorder.snapshot();
  if (snap.owner !== session.pubkey) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    event?: InputEvent;
    events?: InputEvent[];
  };
  const events = body.events ?? (body.event ? [body.event] : []);
  for (const ev of events) await recorder.dispatchInput(ev);
  return NextResponse.json({ ok: true });
}
