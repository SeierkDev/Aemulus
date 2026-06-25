import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getQuota } from "@/lib/quota";
import { getSkill } from "@/lib/skills";
import { executeRun } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const { skillId, input } = (await req.json().catch(() => ({}))) as {
      skillId?: string;
      input?: Record<string, string>;
    };
    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }
    const skill = await getSkill(skillId);
    if (!skill || skill.owner !== session.pubkey) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: `Daily run limit reached (${quota.limit}/24h on the ${quota.tier} tier). Hold more $MIMIC to raise it.`,
        },
        { status: 429 },
      );
    }
    const run = await executeRun(skill, input ?? {}, {}, session.pubkey);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 },
    );
  }
}
