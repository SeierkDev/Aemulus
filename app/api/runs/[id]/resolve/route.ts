import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getQuota } from "@/lib/quota";
import { getRun } from "@/lib/runs";
import { getSkill } from "@/lib/skills";
import { executeRun } from "@/lib/runner";
import { readJson, ResolveBody } from "@/lib/validate";
import type { RunOverrides } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Resolve a flagged step and retry. The fix (a corrected selector and/or skip)
 * is merged into the original run's overrides — so fixes accumulate across
 * successive retries — and a fresh run executes the skill with them applied.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const { id } = await params;
    const original = await getRun(id);
    if (!original || original.owner !== session.pubkey) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const skill = await getSkill(original.skillId);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const parsed = await readJson(req, ResolveBody);
    if (!parsed.ok) return parsed.res;
    const body = parsed.data;

    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: `Daily run limit reached (${quota.limit}/24h on the ${quota.tier} tier). Hold more $AEMU to raise it.`,
        },
        { status: 429 },
      );
    }

    const overrides: RunOverrides = {
      ...original.overrides,
      [body.stepIdx]: {
        ...(body.selector ? { selector: body.selector } : {}),
        ...(body.skip ? { skip: true } : {}),
      },
    };

    const run = await executeRun(skill, original.input, overrides, session.pubkey);
    return NextResponse.json({ run });
  } catch (err) {
    logError("api/runs/resolve", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Resolve failed" },
      { status: 500 },
    );
  }
}
