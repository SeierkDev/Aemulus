import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getRun } from "@/lib/runs";
import { getSkill } from "@/lib/skills";
import { executeRun } from "@/lib/runner";
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
    if (!(await requireAccess())) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const { id } = await params;
    const original = await getRun(id);
    if (!original) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const skill = await getSkill(original.skillId);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      stepIdx?: number;
      selector?: string;
      skip?: boolean;
    };
    if (typeof body.stepIdx !== "number") {
      return NextResponse.json({ error: "stepIdx is required" }, { status: 400 });
    }

    const overrides: RunOverrides = {
      ...original.overrides,
      [body.stepIdx]: {
        ...(body.selector ? { selector: body.selector } : {}),
        ...(body.skip ? { skip: true } : {}),
      },
    };

    const run = await executeRun(skill, original.input, overrides);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Resolve failed" },
      { status: 500 },
    );
  }
}
