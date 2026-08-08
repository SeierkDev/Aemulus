import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { getSkill } from "@/lib/skills";
import {
  createSchedule,
  countActiveSchedules,
  countAllSchedules,
  listSchedules,
  setWatch,
  setWatchAction,
  getWatch,
  MAX_ACTIVE_SCHEDULES,
  MAX_TOTAL_SCHEDULES,
  affordableCadences,
} from "@/lib/schedules";
import { computeTier, getAemulusBalance, watchLimitForLevel } from "@/lib/solana";
import { readJson, WatchCreateBody } from "@/lib/validate";
import { actionTargetProblem, parseAction } from "@/lib/watch-action";
import { ruleFitsCapture, ruleIsUsable } from "@/lib/watches";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Watches, from code.
 *
 * Until now a watch could only be built in the Telegram wizard: three taps, and
 * no way at all to say "monitor this page" from a program. That made the engine
 * unreachable for exactly the people most likely to want it — anyone already
 * automating something and wanting to be told when it changes.
 *
 * A watch is a schedule plus a rule, and creating them separately leaves a
 * window where a schedule is firing runs that no rule reads. So this does both,
 * and rolls the schedule back if the rule cannot be attached.
 */

/** List your watches. */
export async function GET(req: Request) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  if (!hasScope(auth.scopes, "read")) {
    return NextResponse.json({ error: "API key lacks 'read' scope" }, { status: 403 });
  }
  const scheds = await listSchedules(auth.owner);
  const watches = [];
  for (const s of scheds) {
    const w = await getWatch(s.id);
    if (!w) continue; // a plain schedule, not a watch
    watches.push({
      id: s.id,
      skillId: s.skillId,
      skillName: s.skillName,
      cadence: s.cadence,
      active: s.active,
      rule: w.rule,
      // Surfaced because a watch that STARTS A SKILL is materially different
      // from one that only messages, and a consumer had no way to tell them
      // apart — including the one it just created itself.
      action:
        w.action && w.action.kind === "run_skill"
          ? { kind: "run_skill", skillId: w.action.skillId }
          : { kind: "alert" },
      lastValue: w.state.lastValue,
      mutedUntil: w.mutedUntil ?? null,
      lastRunAt: s.lastRunAt ?? null,
      nextRunAt: s.nextRunAt,
    });
  }
  return NextResponse.json({ watches });
}

/** Create a watch: a schedule that checks a page, plus the rule that reads it. */
export async function POST(req: Request) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  if (!hasScope(auth.scopes, "run")) {
    return NextResponse.json({ error: "API key lacks 'run' scope" }, { status: 403 });
  }
  const parsed = await readJson(req, WatchCreateBody);
  if (!parsed.ok) return parsed.res;
  const { skillId, cadence, input, rule, notify, action } = parsed.data;

  const skill = await getSkill(skillId);
  if (!skill || (skill.owner !== auth.owner && !skill.published)) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  // The tier is derived from the wallet's balance, exactly as it is for a
  // browser session: an API key must not be a way to buy a cadence the site
  // would refuse.
  const tier = computeTier(await getAemulusBalance(auth.owner));
  const affordable = affordableCadences(watchLimitForLevel(tier.level));
  if (!affordable.includes(cadence)) {
    // Said BEFORE the watch exists. The scheduler used to accept any cadence
    // and then silently skip what it could not pay for, which is
    // indistinguishable from a watch that quietly broke.
    return NextResponse.json(
      {
        error: `Your tier cannot sustain ${cadence} checks.`,
        affordable,
      },
      { status: 403 },
    );
  }

  // Refused BEFORE a schedule exists: an unsatisfiable rule would otherwise
  // create a watch that runs every cadence and can never fire, which reads as
  // "the page has not changed" rather than as the mistake it is.
  if (!ruleFitsCapture(rule, skill.plan)) {
    return NextResponse.json(
      { error: `"${rule.key}" captures a list, so it cannot be compared as a number.` },
      { status: 400 },
    );
  }
  if (!ruleIsUsable(rule)) {
    return NextResponse.json(
      { error: `"${rule.op}" needs a value to compare against.` },
      { status: 400 },
    );
  }

  if ((await countActiveSchedules(auth.owner)) >= MAX_ACTIVE_SCHEDULES) {
    return NextResponse.json(
      { error: `Active schedule limit reached (max ${MAX_ACTIVE_SCHEDULES}).` },
      { status: 409 },
    );
  }
  if ((await countAllSchedules(auth.owner)) >= MAX_TOTAL_SCHEDULES) {
    return NextResponse.json(
      { error: `Total schedule limit reached (max ${MAX_TOTAL_SCHEDULES}); delete some to add more.` },
      { status: 409 },
    );
  }

  const id = await createSchedule({
    owner: auth.owner,
    skillId,
    input: input ?? {},
    cadence,
    level: tier.level,
    tier: tier.name,
  });

  const attached = await setWatch(id, auth.owner, rule, notify ?? null);
  // Set before the failure check below: an unusable action must not leave a
  // schedule that fires runs nothing reads, and the rollback path covers both.
  if (attached && action && action.kind === "run_skill") {
    const parsed = parseAction(action);
    if (parsed.kind !== "run_skill") {
      const { deleteSchedule } = await import("@/lib/schedules");
      await deleteSchedule(id, auth.owner).catch(() => {});
      return NextResponse.json(
        { error: "A run_skill action needs a skillId." },
        { status: 400 },
      );
    }
    // Same principle as the rule above: an action the engine will always refuse
    // makes a watch that fires, does nothing, and says so every cadence.
    const problem = await actionTargetProblem(parsed.skillId, auth.owner, skillId);
    if (problem) {
      const { deleteSchedule } = await import("@/lib/schedules");
      await deleteSchedule(id, auth.owner).catch(() => {});
      return NextResponse.json({ error: problem }, { status: 400 });
    }
    await setWatchAction(id, auth.owner, parsed);
  }
  if (!attached) {
    // Never leave a schedule firing runs that nothing reads. It would burn the
    // watch allowance every cadence and report nothing, forever.
    const { deleteSchedule } = await import("@/lib/schedules");
    await deleteSchedule(id, auth.owner).catch((e) =>
      logError("api/v1/watches.rollback", e, { schedule: id }),
    );
    return NextResponse.json({ error: "Could not attach the watch rule." }, { status: 500 });
  }

  return NextResponse.json({ id, cadence, rule }, { status: 201 });
}
