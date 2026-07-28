import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getSkill } from "@/lib/skills";
import { reportSkill } from "@/lib/moderation";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, ReportBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report a published skill. Enough distinct reports auto-unpublish it. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(
      `report:${session.pubkey}`,
      10,
      60_000,
      "Too many reports",
    );
    if (limited) return limited;

    const { id } = await params;
    const skill = await getSkill(id);
    // Only a PUBLISHED skill is reportable. Without this, reports could be pre-loaded
    // against a still-private skill (a known/guessed id + N wallets), so it crosses the
    // takedown threshold the moment the owner publishes — they can't keep it up. Treat
    // an unpublished skill as not found (don't reveal it exists to a reporter).
    if (!skill || !skill.published) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    if (skill.owner === session.pubkey) {
      return NextResponse.json({ error: "You can't report your own skill" }, { status: 400 });
    }

    const parsed = await readJson(req, ReportBody);
    if (!parsed.ok) return parsed.res;

    const { reports, tookDown } = await reportSkill(
      id,
      session.pubkey,
      parsed.data.reason ?? "",
    );
    return NextResponse.json({ ok: true, reports, tookDown });
  } catch (err) {
    logError("api/skills/report", err);
    return NextResponse.json({ error: "Report failed" }, { status: 500 });
  }
}
