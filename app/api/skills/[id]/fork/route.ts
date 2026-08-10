import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { forkSkill } from "@/lib/skills";
import { enforceRateLimit } from "@/lib/ratelimit";
import { logError } from "@/lib/log";

/**
 * Per wallet, per hour — the same shape the other two skill-creation routes
 * use. Higher than theirs because a fork costs no model call, and still a
 * ceiling: each one writes a skill row and a version snapshot, and the
 * per-owner cap it also respects is checked without a lock, so hammering this
 * is how you would race past it.
 */
const PER_HOUR = Math.max(1, Number(process.env.AEMULUS_FORK_PER_HOUR) || 60);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fork a skill: take a copy you own and can change.
 *
 * The marketplace was read-only in practice — run what is there, or record your
 * own from nothing. A skill that is nearly right for your portal was a dead
 * end. This is the in-between.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(
      `fork:${session.pubkey}`,
      PER_HOUR,
      60 * 60 * 1000,
      `Too many forks (limit ${PER_HOUR}/hour)`,
    );
    if (limited) return limited;
    const { id } = await params;
    const res = await forkSkill(id, session.pubkey);
    if ("refused" in res) {
      return NextResponse.json({ error: res.refused }, { status: 403 });
    }
    return NextResponse.json({ id: res.id });
  } catch (e) {
    logError("api/skills.fork", e);
    return NextResponse.json({ error: "Could not fork this skill." }, { status: 500 });
  }
}
