import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getQuota } from "@/lib/quota";
import { getRun } from "@/lib/runs";
import { getSkill, skillAccess } from "@/lib/skills";
import { startRun } from "@/lib/run-service";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RUNS_PER_MIN = Math.max(1, Number(process.env.AEMULUS_RUNS_PER_MIN) || 10);

/**
 * Retry a run: start a fresh run with the SAME input and any corrected
 * selectors/skips accumulated on the original (so a failed run re-runs WITH
 * your fixes carried over). Browser state can't resume mid-session, so prior
 * steps are replayed - the inherited overrides let it get past where it stuck.
 */
export async function POST(
  _req: Request,
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
    // Only retry a SETTLED run — retrying one that's still running/awaiting_input
    // would spawn a concurrent duplicate of the same run.
    if (!["completed", "failed", "needs_review"].includes(original.status)) {
      return NextResponse.json({ error: "Run is not finished yet" }, { status: 409 });
    }
    const skill = await getSkill(original.skillId);
    if (!skill || !(await skillAccess(skill, session.pubkey)).run) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `Daily run limit reached (${quota.limit}/24h on the ${quota.tier} tier).` },
        { status: 429 },
      );
    }

    const run = await startRun({
      skill,
      input: original.input,
      overrides: original.overrides,
      runner: session.pubkey,
    });
    return NextResponse.json({ run });
  } catch (err) {
    logError("api/runs/retry", err);
    return NextResponse.json(
      { error: "Retry failed" },
      { status: 500 },
    );
  }
}
