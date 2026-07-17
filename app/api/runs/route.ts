import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getQuota, quotaReserve } from "@/lib/quota";
import { getSkill, skillAccess } from "@/lib/skills";
import { startRun, QuotaExceededError } from "@/lib/run-service";
import { enforceRateLimit, RUNS_PER_MIN } from "@/lib/ratelimit";
import { readJson, RunBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(
      `run:${session.pubkey}`,
      RUNS_PER_MIN,
      60_000,
      `Too many runs (limit ${RUNS_PER_MIN}/min)`,
    );
    if (limited) return limited;
    const parsed = await readJson(req, RunBody);
    if (!parsed.ok) return parsed.res;
    const { skillId, input } = parsed.data;
    const skill = await getSkill(skillId);
    // Runnable if you own it, an org-mate shared it, or it's published.
    if (!skill || !(await skillAccess(skill, session.pubkey)).run) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: `Daily run limit reached (${quota.limit}/24h on the ${quota.tier} tier). Hold more $AEMU to raise it.`,
        },
        { status: 429 },
      );
    }
    const run = await startRun({
      skill,
      input: input ?? {},
      runner: session.pubkey,
      quota: quotaReserve(session),
    });
    return NextResponse.json({ run });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    logError("api/runs", err);
    return NextResponse.json(
      { error: "Run failed" },
      { status: 500 },
    );
  }
}
