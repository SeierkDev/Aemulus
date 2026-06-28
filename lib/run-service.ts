import { executeRun } from "./runner";
import { incrementRunCount } from "./skills";
import { creditEarning } from "./earnings";
import { SOLANA } from "./solana";
import type { Run, RunOverrides, Skill } from "./types";

/**
 * Execute a skill and do the marketplace accounting in one place (used by both
 * the interactive run API and the autonomous scheduler): bump the skill's run
 * count and, when the runner isn't the creator, credit the creator a run fee.
 */
export async function executeAndAccount(
  skill: Skill,
  input: Record<string, string>,
  overrides: RunOverrides,
  runner: string,
): Promise<Run> {
  const run = await executeRun(skill, input, overrides, runner);
  await incrementRunCount(skill.id);
  if (skill.owner && skill.owner !== runner) {
    await creditEarning({
      owner: skill.owner,
      skillId: skill.id,
      runId: run.id,
      runner,
      amount: SOLANA.runFee,
    });
  }
  return run;
}
