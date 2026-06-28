import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getRecorder } from "@/lib/recorder";
import { readJson, RecordInputBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forward a user input event from the streamed view to the recorded page. */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const parsed = await readJson(req, RecordInputBody);
  if (!parsed.ok) return parsed.res;
  const { event, events } = parsed.data;
  const rec = getRecorder(session.pubkey);
  const list = events ?? (event ? [event] : []);
  for (const ev of list) await rec.dispatchInput(ev);
  return NextResponse.json({ ok: true });
}
