import { planHasChaining, startChainedRun } from "./chain";
import { getSkill, skillAccess, templateTool } from "./skills";
import { logError, logInfo } from "./log";
import { incr } from "./metrics";

/**
 * What a watch DOES when its rule fires.
 *
 * Until now a watch could only say something. That is enough for a dashboard
 * and useless for anything where being told and acting are minutes apart — a
 * claim window opening, an allocation appearing, a status finally flipping to
 * something you were waiting to respond to. The rule already knows the moment;
 * this is what happens at it.
 *
 * The action reuses the chaining path (lib/chain.ts) rather than starting a run
 * of its own, which is deliberate: that path already meters against the owner's
 * daily quota, refuses templates and unrunnable skills, refuses nested
 * chaining, and marks the run failed if the enqueue write is lost. A second
 * implementation would be a second place for those guards to drift out of.
 */

export type WatchAction =
  | { kind: "alert" }
  | {
      kind: "run_skill";
      skillId: string;
      /** Send the message as well as running the skill. Defaults to true. */
      alsoAlert?: boolean;
    };

export const DEFAULT_ACTION: WatchAction = { kind: "alert" };

/** Parse a stored action, falling back to alert-only for anything unusable. */
export function parseAction(raw: unknown): WatchAction {
  if (!raw || typeof raw !== "object") return DEFAULT_ACTION;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "run_skill") return DEFAULT_ACTION;
  const skillId = typeof o.skillId === "string" ? o.skillId.trim() : "";
  if (!skillId) return DEFAULT_ACTION;
  return {
    kind: "run_skill",
    skillId,
    // Only an explicit false silences the message. A stored action that predates
    // this field, or one written by a client that omitted it, still tells the
    // owner what happened — silence is the wrong default for something that
    // just went and did work on their behalf.
    alsoAlert: o.alsoAlert !== false,
  };
}

/**
 * Does this action want the message sent too?
 *
 * Tolerates a missing action. A watch stored before this feature has no action
 * column, and any caller that reads a watch without mapping it would otherwise
 * hand over undefined — which must mean "just alert", the behaviour every watch
 * had until now, not a crash that swallows the alert entirely.
 */
export function shouldAlert(action: WatchAction | null | undefined): boolean {
  if (!action) return true;
  return action.kind !== "run_skill" || action.alsoAlert !== false;
}

/**
 * Why this skill could never be a watch's action, or null if it can.
 *
 * The create routes already refuse an unsatisfiable RULE before a schedule
 * exists, on the grounds that a watch which runs every cadence and can never
 * fire reads as "nothing has changed" rather than as the mistake it is. An
 * action naming a skill the engine will always refuse produces exactly that
 * watch — it fires, does nothing, and says so every time — so it is answered in
 * the same place, with the same reasons chain applies at fire time.
 */
export async function actionTargetProblem(
  skillId: string,
  owner: string,
  watchedSkillId: string,
): Promise<string | null> {
  if (skillId === watchedSkillId) {
    return "A watch cannot run the skill it is watching.";
  }
  const sub = await getSkill(skillId);
  if (!sub) return "That skill does not exist.";
  if (!(await skillAccess(sub, owner)).run) return "You cannot run that skill.";
  if (templateTool(sub)) {
    return "That is a marketplace template — record your own copy before a watch can run it.";
  }
  if (planHasChaining(sub.plan)) {
    return "That skill runs another skill of its own, which a watch cannot start.";
  }
  return null;
}

export type ActionResult =
  | { ran: false; reason: string }
  | { ran: true; runId: string };

/**
 * Fire a watch's action.
 *
 * Never throws. A watch hangs off a run that has already completed and had its
 * receipt attached, so the worst outcome here has to be a missed action and a
 * log line — not a settled run that reports failure because something after it
 * went wrong.
 *
 * The watched value is handed to the triggered skill as an input, matched by
 * key exactly the way a chained skill receives its parent's outputs. A skill
 * that declares no matching field simply ignores it.
 */
export async function fireWatchAction(args: {
  action: WatchAction | null | undefined;
  owner: string;
  /** The skill the WATCH runs — the trigger, not the target. */
  watchedSkillId: string;
  /** The key the rule watches, and the value that just fired it. */
  key: string;
  value: string;
  scheduleId: string;
}): Promise<ActionResult> {
  const action = args.action;
  // Guarded rather than assumed: this dereference used to sit OUTSIDE the try
  // below, so a watch with no action — every watch that predates this column —
  // threw a TypeError that escaped into the caller's catch and swallowed the
  // alert. A watch losing its alert because it has no ACTION is precisely
  // backwards.
  if (!action || action.kind !== "run_skill") return { ran: false, reason: "alert only" };
  try {
    const res = await startChainedRun({
      // The watched skill is passed as the parent so chain's self-reference
      // guard applies: a watch on a skill cannot trigger that same skill, which
      // would run it, complete, and be indistinguishable from the check itself.
      parentSkillId: args.watchedSkillId,
      subSkillId: action.skillId,
      owner: args.owner,
      parentInput: {},
      parentOutputs: { [args.key]: args.value },
    });
    if ("skipped" in res) {
      logInfo("watch.action.skipped", res.skipped, { schedule: args.scheduleId });
      return { ran: false, reason: res.skipped };
    }
    incr("watch.actions.fired");
    logInfo("watch.action", "triggered a skill", {
      schedule: args.scheduleId,
      run: res.runId,
    });
    return { ran: true, runId: res.runId };
  } catch (e) {
    logError("watch.action", e, { schedule: args.scheduleId });
    return { ran: false, reason: "the triggered run could not be started" };
  }
}
