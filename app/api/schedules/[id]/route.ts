import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { deleteSchedule, setScheduleActive } from "@/lib/schedules";
import { readJson, ScheduleToggleBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pause/resume a schedule. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = await readJson(req, ScheduleToggleBody);
  if (!parsed.ok) return parsed.res;
  const ok = await setScheduleActive(id, session.pubkey, parsed.data.active);
  if (!ok) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  return NextResponse.json({ active: parsed.data.active });
}

/** Delete a schedule. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = await deleteSchedule(id, session.pubkey);
  if (!ok) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
