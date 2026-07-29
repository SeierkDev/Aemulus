import { NextResponse } from "next/server";
import { apiKeyAuth, hasScope } from "@/lib/api-keys";
import { logError } from "@/lib/log";
import { getQuota, quotaReserve } from "@/lib/quota";
import { getSkill, skillAccess } from "@/lib/skills";
import { startRun, QuotaExceededError } from "@/lib/run-service";
import { computeTier, getAemulusBalance } from "@/lib/solana";
import { rateLimit, RUNS_PER_MIN } from "@/lib/ratelimit";
import { withIdempotency } from "@/lib/idempotency";
import { listRunsPage } from "@/lib/runs";
import { decodeCursor, parseLimit } from "@/lib/pagination";
import { readJson, RunBody } from "@/lib/validate";
import { checkValues } from "@/lib/content-safety";
import type { Session } from "@/lib/siws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public API: list the caller's runs (newest first). Cursor-paginated. */
export async function GET(req: Request) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  if (!hasScope(auth.scopes, "read")) {
    return NextResponse.json({ error: "API key lacks 'read' scope" }, { status: 403 });
  }
  const owner = auth.owner;
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const { items, nextCursor } = await listRunsPage(owner, limit, cursor);
  return NextResponse.json({
    runs: items.map((r) => ({
      id: r.id,
      skillId: r.skillId,
      status: r.status,
      output: r.output,
      receiptHash: r.receiptHash,
      createdAt: r.createdAt,
    })),
    nextCursor,
  });
}

/** Public API: run a skill. Auth: `Authorization: Bearer aem_live_…`. */
export async function POST(req: Request) {
  try {
    const auth = await apiKeyAuth(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      );
    }
    const owner = auth.owner;
    if (!hasScope(auth.scopes, "run")) {
      return NextResponse.json({ error: "API key lacks 'run' scope" }, { status: 403 });
    }

    // Rate limit + advertise the budget via standard headers.
    const rl = rateLimit(`run:${owner}`, RUNS_PER_MIN, 60_000);
    const rlHeaders: Record<string, string> = {
      "X-RateLimit-Limit": String(RUNS_PER_MIN),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(
        Math.ceil((Date.now() + (rl.ok ? 60_000 : rl.retryAfterMs)) / 1000),
      ),
    };
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many runs (limit ${RUNS_PER_MIN}/min)` },
        {
          status: 429,
          headers: {
            ...rlHeaders,
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          },
        },
      );
    }

    const parsed = await readJson(req, RunBody);
    if (!parsed.ok) return parsed.res;
    const { skillId, input } = parsed.data;

    const safety = await checkValues(input ?? {});
    if (!safety.allowed) {
      return NextResponse.json({ error: safety.reason }, { status: 400 });
    }

    const skill = await getSkill(skillId);
    if (!skill || !(await skillAccess(skill, owner)).run) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const tier = computeTier(await getAemulusBalance(owner));
    const session: Session = {
      pubkey: owner,
      tier: tier.name as Session["tier"],
      level: tier.level,
      balance: 0,
    };
    if (tier.level < 1) {
      return NextResponse.json(
        { error: "Insufficient $AEMU balance for access." },
        { status: 403 },
      );
    }
    const quota = await getQuota(session);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `Daily run limit reached (${quota.limit}/24h on ${quota.tier}).` },
        { status: 429, headers: rlHeaders },
      );
    }

    // Idempotent: a retry with the same Idempotency-Key returns the original
    // run instead of starting a second one.
    const { status, body } = await withIdempotency(
      owner,
      "v1/runs",
      req.headers.get("idempotency-key"),
      async () => {
        const run = await startRun({ skill, input: input ?? {}, runner: owner, quota: quotaReserve(session) });
        return { status: 200, body: { id: run.id, status: run.status } };
      },
    );
    return NextResponse.json(body, { status, headers: rlHeaders });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    logError("api/v1/runs", err);
    return NextResponse.json(
      { error: "Run failed" },
      { status: 500 },
    );
  }
}
