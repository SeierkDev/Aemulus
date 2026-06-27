import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { getDemonstration } from "@/lib/demonstrations";
import { generalizeDemonstration } from "@/lib/generalize";
import { createSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PER_HOUR = Math.max(1, Number(process.env.MIMIC_GENERALIZE_PER_HOUR) || 20);

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const rl = rateLimit(`gen:${session.pubkey}`, PER_HOUR, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Too many generalizations — limit is ${PER_HOUR}/hour. Try again in ${Math.ceil(rl.retryAfterMs / 60000)} min.`,
        },
        { status: 429 },
      );
    }
    const { demonstrationId } = (await req.json().catch(() => ({}))) as {
      demonstrationId?: string;
    };
    if (!demonstrationId) {
      return NextResponse.json(
        { error: "demonstrationId is required" },
        { status: 400 },
      );
    }
    const demo = await getDemonstration(demonstrationId);
    if (!demo || demo.owner !== session.pubkey) {
      return NextResponse.json(
        { error: "Demonstration not found" },
        { status: 404 },
      );
    }
    const generalized = await generalizeDemonstration(demo);
    const skill = await createSkill({
      owner: session.pubkey,
      generalized,
      sourceDemoId: demo.id,
    });
    return NextResponse.json({ skill });
  } catch (err) {
    logError("api/skills/generalize", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to generalize",
      },
      { status: 500 },
    );
  }
}
