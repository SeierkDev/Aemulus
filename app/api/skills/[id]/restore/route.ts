import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getSkill, restoreSkillVersion } from "@/lib/skills";
import { readJson, RestoreBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Restore a skill to a prior version (owner only). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const { id } = await params;
    const skill = await getSkill(id);
    if (!skill || skill.owner !== session.pubkey) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const parsed = await readJson(req, RestoreBody);
    if (!parsed.ok) return parsed.res;

    const ok = await restoreSkillVersion(id, parsed.data.version);
    if (!ok) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/skills/restore", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restore failed" },
      { status: 500 },
    );
  }
}
