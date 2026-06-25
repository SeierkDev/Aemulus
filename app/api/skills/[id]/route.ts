import { NextResponse } from "next/server";
import { getSkill, updateSkill } from "@/lib/skills";
import type { SkillInputField, SkillStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await getSkill(id);
  if (!existing) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    plan?: SkillStep[];
    inputSchema?: { fields: SkillInputField[] };
  };

  await updateSkill(id, {
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    plan: body.plan ?? existing.plan,
    inputSchema: body.inputSchema ?? existing.inputSchema,
  });
  const updated = await getSkill(id);
  return NextResponse.json({ skill: updated });
}
