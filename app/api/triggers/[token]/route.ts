import { NextResponse } from "next/server";
import { resolveTrigger, recordTriggerFire } from "@/lib/triggers";
import { getSkill, skillAccess } from "@/lib/skills";
import { startRun, QuotaExceededError } from "@/lib/run-service";
import { getQuota, quotaReserve } from "@/lib/quota";
import { computeTier, getAemulusBalance } from "@/lib/solana";
import { rateLimit, RUNS_PER_MIN } from "@/lib/ratelimit";
import { incr } from "@/lib/metrics";
import { logError } from "@/lib/log";
import type { Session } from "@/lib/siws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound trigger: POST here (the token is the credential) to start a run.
 * The JSON body's keys that match the skill's input fields become the run's
 * input. The run executes as the trigger's owner (your own automation).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const trig = await resolveTrigger(token);
    if (!trig) {
      return NextResponse.json({ error: "Unknown trigger" }, { status: 404 });
    }
    // Per-trigger AND per-owner limits: the owner cap (same key as /api/runs)
    // stops many triggers from bursting past the per-wallet runs/min ceiling.
    if (!rateLimit(`trigger:${trig.id}`, 30, 60_000).ok ||
        !rateLimit(`run:${trig.owner}`, RUNS_PER_MIN, 60_000).ok) {
      return NextResponse.json({ error: "Too many triggers" }, { status: 429 });
    }
    const skill = await getSkill(trig.skillId);
    // Re-validate the trigger owner's access at fire time, not just at creation:
    // if they've lost access (e.g. removed from the org the skill was shared
    // through, or it was taken down), the trigger stops working. The owner of a
    // private skill always retains access, so personal automation is unaffected.
    if (!skill || !(await skillAccess(skill, trig.owner)).run) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    // Map the POST body onto the skill's declared inputs (ignore extras). This
    // is the one PUBLIC input path, so cap each value (5000) like the
    // authenticated routes do via zod.
    const body = await req.json().catch(() => ({}));
    const input: Record<string, string> = {};
    for (const f of skill.inputSchema.fields) {
      if (body && body[f.key] != null) input[f.key] = String(body[f.key]).slice(0, 5000);
    }

    const tier = computeTier(await getAemulusBalance(trig.owner));
    // Explicit access gate (matches the MCP + REST run paths): a wallet with no
    // access can't fire runs, independent of how the quota limit is configured.
    if (tier.level < 1) {
      return NextResponse.json({ error: "Wallet no longer has access" }, { status: 403 });
    }
    const session: Session = {
      pubkey: trig.owner,
      tier: tier.name as Session["tier"],
      level: tier.level,
      balance: 0,
    };
    if (!(await getQuota(session)).ok) {
      return NextResponse.json({ error: "Daily run quota reached" }, { status: 429 });
    }

    const run = await startRun({ skill, input, runner: trig.owner, quota: quotaReserve(session) });
    await recordTriggerFire(trig.id);
    incr("triggers.fired");
    return NextResponse.json({ ok: true, runId: run.id });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    logError("api/triggers", err);
    return NextResponse.json({ error: "Trigger failed" }, { status: 500 });
  }
}
