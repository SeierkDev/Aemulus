import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getDemonstration } from "@/lib/demonstrations";
import { synthesizeSkill } from "@/lib/synthesize";
import { createSkill, countSkillsByOwner, MAX_SKILLS_PER_OWNER } from "@/lib/skills";
import { recordedNavHosts, incompleteRecordingReason } from "@/lib/skill-utils";
import { readJson, SynthesizeBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Dedicated cap, falling back to the generalize cap for back-compat.
const PER_HOUR = Math.max(
  1,
  Number(process.env.AEMULUS_SYNTHESIZE_PER_HOUR || process.env.AEMULUS_GENERALIZE_PER_HOUR) || 20,
);

/** Synthesize one skill from several demonstrations of the same task. */
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

    const parsed = await readJson(req, SynthesizeBody);
    if (!parsed.ok) return parsed.res;

    // Load every demonstration, owner-checked.
    const demos = [];
    for (const id of parsed.data.demonstrationIds) {
      const demo = await getDemonstration(id);
      if (!demo || demo.owner !== session.pubkey) {
        return NextResponse.json(
          { error: "Demonstration not found" },
          { status: 404 },
        );
      }
      const incomplete = incompleteRecordingReason(demo.trace);
      if (incomplete) {
        return NextResponse.json({ error: incomplete }, { status: 400 });
      }
      demos.push(demo);
    }

    if ((await countSkillsByOwner(session.pubkey)) >= MAX_SKILLS_PER_OWNER) {
      return NextResponse.json({ error: `Skill limit reached (max ${MAX_SKILLS_PER_OWNER}).` }, { status: 409 });
    }
    const result = await synthesizeSkill(demos);
    const skill = await createSkill({
      owner: session.pubkey,
      generalized: result.skill,
      sourceDemoId: demos[0].id,
      // Real navigations across all source demos (not the model's plan).
      allowedHosts: [...new Set(demos.flatMap((d) => recordedNavHosts(d.trace)))],
    });
    return NextResponse.json({
      skill,
      synthesis: {
        demoCount: result.demoCount,
        iterations: result.iterations,
        verified: result.verified,
        issues: result.issues,
      },
    });
  } catch (err) {
    logError("api/skills/synthesize", err);
    return NextResponse.json(
      { error: "Failed to synthesize a skill." },
      { status: 500 },
    );
  }
}
