import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { deleteSchedule, setScheduleActive, getWatch } from "@/lib/schedules";
import { readJson } from "@/lib/validate";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({ active: z.boolean() });

/** Pause or resume a watch. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  if (!hasScope(auth.scopes, "run")) {
    return NextResponse.json({ error: "API key lacks 'run' scope" }, { status: 403 });
  }
  const parsed = await readJson(req, PatchBody);
  if (!parsed.ok) return parsed.res;

  const { id } = await params;
  // Every mutation is scoped to the key's owner inside the query itself, so a
  // key can never reach another wallet's watch by guessing an id.
  const ok = await setScheduleActive(id, auth.owner, parsed.data.active);
  if (!ok) return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  return NextResponse.json({ id, active: parsed.data.active });
}

/** Delete a watch for good. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  if (!hasScope(auth.scopes, "run")) {
    return NextResponse.json({ error: "API key lacks 'run' scope" }, { status: 403 });
  }
  const { id } = await params;
  const ok = await deleteSchedule(id, auth.owner);
  if (!ok) return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  return NextResponse.json({ id, deleted: true });
}

/** One watch, with its current value and when it last looked. */
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
  const w = await getWatch(id);
  if (!w || w.owner !== auth.owner) {
    return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  }
  return NextResponse.json({
    id,
    rule: w.rule,
    lastValue: w.state.lastValue,
    failStreak: w.state.failStreak,
    mutedUntil: w.mutedUntil ?? null,
  });
}
