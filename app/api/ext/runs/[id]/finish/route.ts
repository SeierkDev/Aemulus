import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/api-keys";
import { getRun } from "@/lib/runs";
import { getSkill } from "@/lib/skills";
import { finalizeExtensionRun, type ExtStepReport } from "@/lib/ext-run";
import { logError } from "@/lib/log";
import type { RunStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Proof screenshots ride along as data URLs, so allow a larger body.
export const maxDuration = 60;

const TERMINAL = new Set<RunStatus>(["completed", "failed", "needs_review"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await apiKeyAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
    }
    const { id } = await params;
    const run = await getRun(id);
    if (!run || run.owner !== auth.owner) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (TERMINAL.has(run.status)) {
      // Already settled (e.g. a duplicate finish) — idempotent success.
      return NextResponse.json({ ok: true, status: run.status, receiptHash: run.receiptHash });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const status = body?.status as RunStatus;
    if (!TERMINAL.has(status)) {
      return NextResponse.json({ error: "status must be completed|failed|needs_review" }, { status: 400 });
    }

    const skill = await getSkill(run.skillId);
    if (!skill) {
      return NextResponse.json({ error: "Skill gone" }, { status: 404 });
    }

    const rawSteps = Array.isArray(body?.steps) ? (body!.steps as unknown[]) : [];
    const steps: ExtStepReport[] = rawSteps
      .slice(0, 1000)
      .map((s) => (s ?? {}) as Record<string, unknown>)
      .filter((s) => typeof s.idx === "number")
      .map((s) => ({
        idx: s.idx as number,
        selectorUsed: typeof s.selectorUsed === "string" ? s.selectorUsed : undefined,
        value: typeof s.value === "string" ? s.value : undefined,
        confidence: typeof s.confidence === "number" ? s.confidence : undefined,
        flagged: s.flagged === true,
        note: typeof s.note === "string" ? s.note : undefined,
        screenshot: typeof s.screenshot === "string" ? s.screenshot : undefined,
      }));

    const outputs: Record<string, string> = {};
    if (body?.outputs && typeof body.outputs === "object") {
      for (const [k, v] of Object.entries(body.outputs as Record<string, unknown>)) {
        if (typeof v === "string") outputs[k] = v.slice(0, 4000);
      }
    }

    const final = await finalizeExtensionRun({
      runId: id,
      owner: auth.owner,
      skill,
      status,
      error: typeof body?.error === "string" ? body.error.slice(0, 400) : null,
      steps,
      outputs,
      tokensIn: typeof body?.tokensIn === "number" ? body.tokensIn : 0,
      tokensOut: typeof body?.tokensOut === "number" ? body.tokensOut : 0,
    });

    return NextResponse.json({ ok: true, status: final.status, receiptHash: final.receiptHash });
  } catch (e) {
    logError("api/ext/runs/finish", e);
    return NextResponse.json({ error: "Could not finalize the run." }, { status: 500 });
  }
}
