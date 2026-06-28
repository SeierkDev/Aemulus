import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getQuota } from "@/lib/quota";
import { getSkill, incrementRunCount } from "@/lib/skills";
import { executeRun } from "@/lib/runner";
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
    const parsed = await readJson(req, RunBody);
    if (!parsed.ok) return parsed.res;
    const { skillId, input } = parsed.data;
    const skill = await getSkill(skillId);
    // Runnable if you own it, or it's published to the marketplace.
    if (!skill || (skill.owner !== session.pubkey && !skill.published)) {
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
    const run = await executeRun(skill, input ?? {}, {}, session.pubkey);
    await incrementRunCount(skill.id);
    return NextResponse.json({ run });
  } catch (err) {
    logError("api/runs", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 },
    );
  }
}
