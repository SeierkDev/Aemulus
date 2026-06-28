import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill } from "@/lib/skills";
import { rateSkill } from "@/lib/reputation";
import { hasRunSkill } from "@/lib/runs";
import { readJson, RateBody } from "@/lib/validate";

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
  const skill = await getSkill(id);
  if (!skill || !skill.published) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  // Only wallets that have actually run the skill may rate it (anti-gaming).
  if (!(await hasRunSkill(session.pubkey, id))) {
    return NextResponse.json(
      { error: "Run this skill before rating it." },
      { status: 403 },
    );
  }
  const parsed = await readJson(req, RateBody);
  if (!parsed.ok) return parsed.res;

  await rateSkill({
    skillId: id,
    rater: session.pubkey,
    stars: parsed.data.stars,
    comment: parsed.data.comment ?? "",
  });
  return NextResponse.json({ ok: true });
}
