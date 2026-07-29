import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { setPublished, getSkill, SkillNotPublishableError } from "@/lib/skills";
import { readJson, PublishBody } from "@/lib/validate";
import { checkText } from "@/lib/content-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = await readJson(req, PublishBody);
  if (!parsed.ok) return parsed.res;
  // Keep the public marketplace clean: a skill's name/description are moderated
  // before it can go live.
  if (parsed.data.published) {
    const skill = await getSkill(id);
    if (skill && skill.owner === session.pubkey) {
      const safety = await checkText(`${skill.name}\n${skill.description}`);
      if (!safety.allowed) {
        return NextResponse.json({ error: safety.reason }, { status: 400 });
      }
    }
  }
  try {
    const ok = await setPublished(id, session.pubkey, parsed.data.published);
    if (!ok) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof SkillNotPublishableError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ published: parsed.data.published });
}
