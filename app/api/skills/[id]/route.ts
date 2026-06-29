import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill, updateSkill } from "@/lib/skills";
import { readJson, SkillUpdateBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await getSkill(id);
  if (!existing || existing.owner !== session.pubkey) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  const parsed = await readJson(req, SkillUpdateBody);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  await updateSkill(id, {
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    plan: body.plan ?? existing.plan,
    inputSchema: body.inputSchema ?? existing.inputSchema,
    allowedHosts: body.allowedHosts ?? existing.allowedHosts,
  });
  const updated = await getSkill(id);
  return NextResponse.json({ skill: updated });
}
