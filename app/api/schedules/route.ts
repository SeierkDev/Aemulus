import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill } from "@/lib/skills";
import { createSchedule } from "@/lib/schedules";
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
