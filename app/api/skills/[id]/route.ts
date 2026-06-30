import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill, updateSkill, skillAccess } from "@/lib/skills";
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
  if (!existing || !(await skillAccess(existing, session.pubkey)).edit) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  const parsed = await readJson(req, SkillUpdateBody);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // allowedHosts gates which vault credentials auto-fill at run time, so only
  // the OWNER may change it — an org admin can edit the plan but not repoint the
  // host (defense around the credential vault).
  const isOwner = existing.owner === session.pubkey;
  await updateSkill(id, {
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    plan: body.plan ?? existing.plan,
    inputSchema: body.inputSchema ?? existing.inputSchema,
    allowedHosts: isOwner
      ? (body.allowedHosts ?? existing.allowedHosts)
      : existing.allowedHosts,
  });
  const updated = await getSkill(id);
  return NextResponse.json({ skill: updated });
}
