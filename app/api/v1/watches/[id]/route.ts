import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { deleteSchedule, setScheduleActive, setWatchAction, getWatch } from "@/lib/schedules";
import { readJson } from "@/lib/validate";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pause/resume, and disarm.
 *
 * Both optional so one call can do either. Without `action`, an API consumer
 * could arm a watch to run a skill at creation and then had no way to stop it
 * through the API at all — the only route was the website, for a surface whose
 * whole point is being drivable from code.
 */
const PatchBody = z
  .object({
    active: z.boolean().optional(),
    action: z.literal("alert").optional(),
  })
  .refine((b) => b.active !== undefined || b.action !== undefined, {
    message: "Send active, action, or both.",
  });

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
  let ok = true;
  if (parsed.data.active !== undefined) {
    ok = await setScheduleActive(id, auth.owner, parsed.data.active);
  }
  if (ok && parsed.data.action === "alert") {
    // Clears the action only. Deleting the watch would take its baseline with
    // it, leaving the replacement quiet through the first real change.
    ok = await setWatchAction(id, auth.owner, { kind: "alert" });
  }
  if (!ok) return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  return NextResponse.json({
    id,
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    ...(parsed.data.action ? { action: "alert" } : {}),
  });
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
    // Same shape the list returns, for the same reason: something that STARTS A
    // RUN on the owner's behalf must be visible wherever the watch is. Missing
    // here, it did not read as absent — the SDK documents action as always
    // present, so an undefined field means "alert", and every consumer checking
    // a single watch was told no watch runs a skill, including one that does.
    action:
      w.action && w.action.kind === "run_skill"
        ? { kind: "run_skill", skillId: w.action.skillId }
        : { kind: "alert" },
    lastValue: w.state.lastValue,
    failStreak: w.state.failStreak,
    mutedUntil: w.mutedUntil ?? null,
  });
}
