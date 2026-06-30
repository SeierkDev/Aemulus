import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getDemonstration } from "@/lib/demonstrations";
import { generalizeDemonstration } from "@/lib/generalize";
import { createSkill } from "@/lib/skills";
import { recordedNavHosts } from "@/lib/skill-utils";
import { readJson, GeneralizeBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PER_HOUR = Math.max(1, Number(process.env.AEMULUS_GENERALIZE_PER_HOUR) || 20);

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(
      `gen:${session.pubkey}`,
      PER_HOUR,
      60 * 60 * 1000,
      `Too many generalizations (limit ${PER_HOUR}/hour)`,
    );
    if (limited) return limited;
    const parsed = await readJson(req, GeneralizeBody);
    if (!parsed.ok) return parsed.res;
    const demo = await getDemonstration(parsed.data.demonstrationId);
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
      allowedHosts: recordedNavHosts(demo.trace),
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
