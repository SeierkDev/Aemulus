import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill } from "@/lib/skills";
import { rateSkill } from "@/lib/reputation";
import { hasRunSkill } from "@/lib/runs";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, RateBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_PER_MIN = Math.max(1, Number(process.env.AEMULUS_RATE_PER_MIN) || 10);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const limited = enforceRateLimit(
    `rate:${session.pubkey}`,
    RATE_PER_MIN,
    60_000,
    `Too many ratings (limit ${RATE_PER_MIN}/min)`,
  );
  if (limited) return limited;
  const { id } = await params;
  const skill = await getSkill(id);
  if (!skill || !skill.published) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  // A creator can't rate their own skill (they can always run it, so hasRunSkill
  // wouldn't stop them) — otherwise avgStars is self-gameable. Matches the
  // self-report guard on the report route.
  if (skill.owner === session.pubkey) {
    return NextResponse.json({ error: "You can't rate your own skill." }, { status: 403 });
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
