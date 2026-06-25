import { NextResponse } from "next/server";
import { getSkill } from "@/lib/skills";
import { executeRun } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { skillId, input } = (await req.json().catch(() => ({}))) as {
      skillId?: string;
      input?: Record<string, string>;
    };
    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }
    const skill = await getSkill(skillId);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const run = await executeRun(skill, input ?? {});
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 },
    );
  }
}
