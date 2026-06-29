import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill } from "@/lib/skills";
import {
  createSchedule,
  countActiveSchedules,
  MAX_ACTIVE_SCHEDULES,
} from "@/lib/schedules";
import { readJson, ScheduleCreateBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create an autonomous schedule for a skill you can run. */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const parsed = await readJson(req, ScheduleCreateBody);
  if (!parsed.ok) return parsed.res;
  const { skillId, cadence, input } = parsed.data;

  const skill = await getSkill(skillId);
  if (!skill || (skill.owner !== session.pubkey && !skill.published)) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  if ((await countActiveSchedules(session.pubkey)) >= MAX_ACTIVE_SCHEDULES) {
    return NextResponse.json(
      { error: `Schedule limit reached (max ${MAX_ACTIVE_SCHEDULES}).` },
      { status: 409 },
    );
  }

  const id = await createSchedule({
    owner: session.pubkey,
    skillId,
    input: input ?? {},
    cadence,
    level: session.level,
    tier: session.tier,
  });
  return NextResponse.json({ id });
}
