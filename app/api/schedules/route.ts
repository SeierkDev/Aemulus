import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill } from "@/lib/skills";
import {
  createSchedule,
  countActiveSchedules,
  countAllSchedules,
  MAX_ACTIVE_SCHEDULES,
  MAX_TOTAL_SCHEDULES,
  setWatch,
  setWatchAction,
  deleteSchedule,
} from "@/lib/schedules";
import { actionTargetProblem, parseAction } from "@/lib/watch-action";
import { ruleFitsCapture, ruleIsUsable } from "@/lib/watches";
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
  const { skillId, cadence, input, rule, action } = parsed.data;

  const skill = await getSkill(skillId);
  if (!skill || (skill.owner !== session.pubkey && !skill.published)) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  if ((await countActiveSchedules(session.pubkey)) >= MAX_ACTIVE_SCHEDULES) {
    return NextResponse.json(
      { error: `Active schedule limit reached (max ${MAX_ACTIVE_SCHEDULES}).` },
      { status: 409 },
    );
  }
  // Total-rows cap: paused schedules are kept (re-activatable), so cap active+paused
  // too - otherwise a create→pause loop grows rows unbounded. Delete some to free room.
  if ((await countAllSchedules(session.pubkey)) >= MAX_TOTAL_SCHEDULES) {
    return NextResponse.json(
      { error: `Total schedule limit reached (max ${MAX_TOTAL_SCHEDULES}); delete some to add more.` },
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

  // A rule turns the schedule into a watch. If attaching it fails, the schedule
  // is removed rather than left running checks nothing reads — that would burn
  // the allowance every cadence and report nothing, forever.
  if (rule) {
    if (!ruleFitsCapture(rule, skill.plan)) {
      await deleteSchedule(id, session.pubkey).catch(() => {});
      return NextResponse.json(
        { error: `"${rule.key}" captures a list, so it cannot be compared as a number.` },
        { status: 400 },
      );
    }
    if (!ruleIsUsable(rule)) {
      await deleteSchedule(id, session.pubkey).catch(() => {});
      return NextResponse.json(
        { error: `"${rule.op}" needs something to compare against.` },
        { status: 400 },
      );
    }
    const attached = await setWatch(id, session.pubkey, rule, null);
    if (!attached) {
      await deleteSchedule(id, session.pubkey).catch(() => {});
      return NextResponse.json({ error: "Could not attach the rule." }, { status: 500 });
    }
    if (action) {
      const parsedAction = parseAction(action);
      if (action.kind === "run_skill" && parsedAction.kind !== "run_skill") {
        await deleteSchedule(id, session.pubkey).catch(() => {});
        return NextResponse.json(
          { error: "Choose a skill to run, or set the action back to alert only." },
          { status: 400 },
        );
      }
      if (parsedAction.kind === "run_skill") {
        // Same principle as the rule above: an action the engine will always
        // refuse makes a watch that fires, does nothing, and says so every
        // cadence. The picker no longer offers these, but the route is what
        // guarantees it.
        const problem = await actionTargetProblem(parsedAction.skillId, session.pubkey, skillId);
        if (problem) {
          await deleteSchedule(id, session.pubkey).catch(() => {});
          return NextResponse.json({ error: problem }, { status: 400 });
        }
      }
      await setWatchAction(id, session.pubkey, parsedAction);
    }
  }
  return NextResponse.json({ id, watching: !!rule });
}
