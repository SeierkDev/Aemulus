import { getSkill, skillAccess, templateTool } from "./skills";
import { createRun, finishRun } from "./runs";
import { quotaReserveForOwner } from "./quota";
import { enqueueRunJob } from "./jobs";
import { incr } from "./metrics";
import type { SkillInputField, SkillStep } from "./types";
import { alertRunNeverStarted } from "./run-alert-telegram";

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
  /** Parent keys holding a credential: vault-filled, or marked secret by its author. */
  secretKeys?: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    // A credential never crosses into the child. The parent's effective input
    // holds vault-filled secrets, and mapping by key alone meant any child
    // field with a MATCHING KEY was filled with one — then persisted, in
    // plaintext, in the child run's input row, outside the vault that exists to
    // be the only place the value lives.
    //
    // The storage is not the worst of it. In the child the value arrives as an
    // ordinary input, so it is not in the child's vaultKeys: unless the child
    // marks that field secret too, it loses host-binding (typed on any allowed
    // host, not only the one the credential is bound to) and it loses redaction
    // (it reaches step records and screenshots). A child fills its own secrets
    // from its own vault, which is the path that keeps all of that intact.
    if (secretKeys?.has(f.key)) continue;
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
  /** Parent keys holding a credential — never mapped onto the child. */
  secretKeys?: Set<string>;
}): Promise<ChainResult> {
  if (!args.subSkillId) return { skipped: "no skill selected" };
  const sub = await getSkill(args.subSkillId);
  if (!sub) return { skipped: "sub-skill not found" };
  if (sub.id === args.parentSkillId) return { skipped: "a skill can't chain to itself" };
  // The same authority every other run path asks: startRun, the extension, the
  // public API and triggers all gate on skillAccess. This used to ask its own
  // narrower question — owner, or published — which silently excluded skills
  // shared through an ORG. A team could run a shared skill by hand from every
  // surface in the product and not as a watch's action, where it came back
  // "not runnable by this owner" on every fire, about a skill they had just
  // run themselves.
  if (!(await skillAccess(sub, args.owner)).run) {
    return { skipped: "sub-skill not runnable by this owner" };
  }
  // A marketplace template has placeholder steps and isn't runnable - don't spend
  // a quota slot on a doomed child run (mirrors the startRun/ext-start guards).
  if (templateTool(sub)) return { skipped: "sub-skill is a template (record your own)" };
  if (planHasChaining(sub.plan)) return { skipped: "nested chaining is not allowed" };

  const input = childInput(
    sub.inputSchema.fields,
    args.parentInput,
    args.parentOutputs,
    args.secretKeys,
  );
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
    // Chaining is fire-and-forget, so this throw has nobody to reach. Without
    // this the parent reports success and the child simply never happened.
    void alertRunNeverStarted(run.id, sub.name).catch(() => {});
    throw e;
  }
  incr("chains.started");
  return { runId: run.id };
}
