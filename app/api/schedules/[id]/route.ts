import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { deleteSchedule, setScheduleActive, setWatchAction } from "@/lib/schedules";
import { readJson, ScheduleActionBody, ScheduleToggleBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disarm a watch's action, leaving the watch itself alone.
 *
 * Without this the only way to stop a watch from running a skill on your behalf
 * was to delete the watch — which throws away its baseline and its history, so
 * the next check has nothing to compare against and stays quiet through the
 * first real change. Being able to see that something is armed and not being
 * able to disarm it is worse than not showing it at all.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = await readJson(req, ScheduleActionBody);
  if (!parsed.ok) return parsed.res;
  const ok = await setWatchAction(id, session.pubkey, { kind: "alert" });
  if (!ok) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  return NextResponse.json({ action: "alert" });
}

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
