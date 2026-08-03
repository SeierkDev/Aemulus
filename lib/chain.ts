import { getSkill, templateTool } from "./skills";
import { createRun, finishRun } from "./runs";
import { quotaReserveForOwner } from "./quota";
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

// A captured output (esp. a loop-extract JSON array) can be large; bound each
// chained value so a hostile page's multi-MB extraction can't bloat the child's
// stored input + enqueued job. The HTTP edge caps user input similarly; this
// closes the equivalent in-process path.
const MAX_CHAIN_VALUE = 100_000; // 100 KB per field

/** Build the child's input: a child field is filled from the parent's captured
 *  output first, then the parent's run input, matched by key. */
export function childInput(
  fields: SkillInputField[],
  parentInput: Record<string, string>,
  parentOutputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    // Use `||` not `??`: an empty-string captured output (a step that extracted
    // nothing) should fall through to the parent's run input, not shadow it.
    const v = parentOutputs[f.key] || parentInput[f.key];
    if (v != null) out[f.key] = String(v).slice(0, MAX_CHAIN_VALUE);
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
  // A marketplace template has placeholder steps and isn't runnable - don't spend
  // a quota slot on a doomed child run (mirrors the startRun/ext-start guards).
  if (templateTool(sub)) return { skipped: "sub-skill is a template (record your own)" };
  if (planHasChaining(sub.plan)) return { skipped: "nested chaining is not allowed" };

  const input = childInput(sub.inputSchema.fields, args.parentInput, args.parentOutputs);
  // Meter the child against the owner's daily quota. Without this, a parent skill with
  // up to 200 `run_skill` steps would spawn that many UNmetered child runs — one
  // metered parent bypassing the cap 200×. Reserve atomically like every user-facing
  // run path (unlimited tiers make it a no-op); refuse the chain step when over quota.
  const run = await createRun({
    owner: args.owner,
    skillId: sub.id,
    input,
    overrides: {},
    skillVersion: sub.version,
    reserve: await quotaReserveForOwner(args.owner),
  });
  if (!run) return { skipped: "daily run limit reached" };
  incr("runs.started");
  // Mirror startRun: if the enqueue write fails after the run row (+ its quota
  // reservation) is created, mark the child failed so it doesn't strand in "running"
  // forever with a permanently-consumed quota slot (no reconciler scans for a run
  // that never got a job).
  try {
    await enqueueRunJob({
      runId: run.id,
      runner: args.owner,
      skillId: sub.id,
      input,
      overrides: {},
    });
  } catch (e) {
    await finishRun(run.id, { status: "failed", error: "Could not queue the chained run." }).catch(() => {});
    throw e;
  }
  incr("chains.started");
  return { runId: run.id };
}
