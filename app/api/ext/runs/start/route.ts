import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { getSkill } from "@/lib/skills";
import { getQuota, quotaReserve } from "@/lib/quota";
import { createRun } from "@/lib/runs";
import { computeTier, getAemulusBalance } from "@/lib/solana";
import { checkValues } from "@/lib/content-safety";
import { logError } from "@/lib/log";
import type { Session } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Start a run the EXTENSION will execute in the user's own browser. Same gates as
// a cloud run (moderation, access tier, daily quota) — but instead of enqueueing
// the Playwright job, we create the run row and hand the plan back to the
// extension, which does the clicking and reports the result to /finish.
export async function POST(req: Request) {
  try {
    const auth = await apiKeyAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
    }
    if (!hasScope(auth.scopes, "run")) {
      return NextResponse.json({ error: "Key lacks the 'run' scope" }, { status: 403 });
    }
    const owner = auth.owner;

    const body = (await req.json().catch(() => null)) as
      | { skillId?: unknown; input?: unknown }
      | null;
    const skillId = typeof body?.skillId === "string" ? body.skillId : "";
    const input: Record<string, string> = {};
    if (body?.input && typeof body.input === "object") {
      for (const [k, v] of Object.entries(body.input as Record<string, unknown>)) {
        if (typeof v === "string") input[k] = v;
      }
    }
    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }

    const safety = await checkValues(input);
    if (!safety.allowed) {
      return NextResponse.json({ error: safety.reason }, { status: 400 });
    }

    const skill = await getSkill(skillId);
    // Extension runs are your-own-skills-only (the plan is handed to the client).
    if (!skill || skill.owner !== owner) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const tier = computeTier(await getAemulusBalance(owner));
    if (tier.level < 1) {
      return NextResponse.json({ error: "Insufficient $AEMU balance for access." }, { status: 403 });
    }
    const session: Session = {
      pubkey: owner,
      tier: tier.name as Session["tier"],
      level: tier.level,
      balance: 0,
    };
    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `Daily run limit reached (${quota.limit}/24h on the ${quota.tier} tier).` },
        { status: 429 },
      );
    }

    const run = await createRun({
      owner,
      skillId: skill.id,
      input,
      overrides: {},
      reserve: quotaReserve(session),
    });
    if (!run) {
      return NextResponse.json({ error: "Daily run quota reached." }, { status: 429 });
    }

    const secretKeys = (skill.inputSchema.fields ?? [])
      .filter((f) => f.secret)
      .map((f) => f.key);

    return NextResponse.json({
      runId: run.id,
      startUrl: skill.plan[0]?.target ?? "",
      allowedHosts: skill.allowedHosts ?? [],
      secretKeys,
      plan: skill.plan,
    });
  } catch (e) {
    logError("api/ext/runs/start", e);
    return NextResponse.json({ error: "Could not start the run." }, { status: 500 });
  }
}
