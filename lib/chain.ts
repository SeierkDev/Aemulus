import { getSkill } from "./skills";
import { createRun } from "./runs";
import { enqueueRunJob } from "./jobs";
import { incr } from "./metrics";
import type { SkillInputField, SkillStep } from "./types";

/**
 * Skill chaining (composition). A "run_skill" step starts a CHILD run of another
 * skill via the durable job queue, auto-mapping the parent's inputs + captured
 * outputs onto the child's input fields by key. Kept to a single level (a chained
 * skill can't itself chain) so there's no recursion to bound.
 */

/** Does a plan contain any chaining step? */
export function planHasChaining(plan: SkillStep[]): boolean {
  return plan.some((s) => s.action === "run_skill");
}

/** Build the child's input: a child field is filled from the parent's captured
 *  output first, then the parent's run input, matched by key. */
export function childInput(
  fields: SkillInputField[],
  parentInput: Record<string, string>,
  parentOutputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = parentOutputs[f.key] ?? parentInput[f.key];
    if (v != null) out[f.key] = String(v);
  }
  return out;
}

export type ChainResult = { runId: string } | { skipped: string };

export async function startChainedRun(args: {
  parentSkillId: string;
  subSkillId: string;
  owner: string;
  parentInput: Record<string, string>;
  parentOutputs: Record<string, string>;
}): Promise<ChainResult> {
  if (!args.subSkillId) return { skipped: "no skill selected" };
  const sub = await getSkill(args.subSkillId);
  if (!sub) return { skipped: "sub-skill not found" };
  if (sub.id === args.parentSkillId) return { skipped: "a skill can't chain to itself" };
  if (sub.owner !== args.owner && !sub.published) {
    return { skipped: "sub-skill not runnable by this owner" };
  }
  if (planHasChaining(sub.plan)) return { skipped: "nested chaining is not allowed" };

  const input = childInput(sub.inputSchema.fields, args.parentInput, args.parentOutputs);
  const run = await createRun({ owner: args.owner, skillId: sub.id, input, overrides: {} });
  incr("runs.started");
  await enqueueRunJob({
    runId: run.id,
    runner: args.owner,
    skillId: sub.id,
    input,
    overrides: {},
  });
  incr("chains.started");
  return { runId: run.id };
}
