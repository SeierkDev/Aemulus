import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getQuota } from "@/lib/quota";
import { getRun } from "@/lib/runs";
import { getSkill, skillAccess } from "@/lib/skills";
import { startRun } from "@/lib/run-service";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, ResolveBody } from "@/lib/validate";
import type { RunOverrides } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RUNS_PER_MIN = Math.max(1, Number(process.env.AEMULUS_RUNS_PER_MIN) || 10);

/**
 * Resolve a flagged step and retry. The fix (a corrected selector and/or skip)
 * is merged into the original run's overrides - so fixes accumulate across
 * successive retries - and a fresh run executes the skill with them applied.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params;
    const original = await getRun(id);
    if (!original || original.owner !== session.pubkey) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const skill = await getSkill(original.skillId);
    if (!skill || !(await skillAccess(skill, session.pubkey)).run) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const parsed = await readJson(req, ResolveBody);
    if (!parsed.ok) return parsed.res;
    const body = parsed.data;

    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: `Daily run limit reached (${quota.limit}/24h on the ${quota.tier} tier). Hold more $AEMU to raise it.`,
        },
        { status: 429 },
      );
    }

    const overrides: RunOverrides = {
      ...original.overrides,
      [body.stepIdx]: {
        ...(body.selector ? { selector: body.selector } : {}),
        ...(body.skip ? { skip: true } : {}),
      },
    };

    const run = await startRun({
      skill,
      input: original.input,
      overrides,
      runner: session.pubkey,
    });
    return NextResponse.json({ run });
  } catch (err) {
    logError("api/runs/resolve", err);
    return NextResponse.json(
      { error: "Resolve failed" },
      { status: 500 },
    );
  }
}
