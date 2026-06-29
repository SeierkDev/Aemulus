import { NextResponse } from "next/server";
import { apiKeyOwner } from "@/lib/api-keys";
import { logError } from "@/lib/log";
import { getQuota } from "@/lib/quota";
import { getSkill } from "@/lib/skills";
import { startRun } from "@/lib/run-service";
import { computeTier, getAemulusBalance } from "@/lib/solana";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, RunBody } from "@/lib/validate";
import type { Session } from "@/lib/siws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS_PER_MIN = Math.max(1, Number(process.env.AEMULUS_RUNS_PER_MIN) || 10);

/** Public API: run a skill. Auth: `Authorization: Bearer aem_live_…`. */
export async function POST(req: Request) {
  try {
    const owner = await apiKeyOwner(req);
    if (!owner) {
      return NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      );
    }
    const limited = enforceRateLimit(
      `run:${owner}`,
      RUNS_PER_MIN,
      60_000,
      `Too many runs (limit ${RUNS_PER_MIN}/min)`,
    );
    if (limited) return limited;

    const parsed = await readJson(req, RunBody);
    if (!parsed.ok) return parsed.res;
    const { skillId, input } = parsed.data;

    const skill = await getSkill(skillId);
    if (!skill || (skill.owner !== owner && !skill.published)) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const tier = computeTier(await getAemulusBalance(owner));
    const session: Session = {
      pubkey: owner,
      tier: tier.name as Session["tier"],
      level: tier.level,
      balance: 0,
    };
    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `Daily run limit reached (${quota.limit}/24h on ${quota.tier}).` },
        { status: 429 },
      );
    }

    const run = await startRun({ skill, input: input ?? {}, runner: owner });
    return NextResponse.json({ id: run.id, status: run.status });
  } catch (err) {
    logError("api/v1/runs", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 },
    );
  }
}
