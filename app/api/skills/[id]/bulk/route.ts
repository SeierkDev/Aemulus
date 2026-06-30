import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { getQuota } from "@/lib/quota";
import { getSkill, skillAccess } from "@/lib/skills";
import { createBulkRun } from "@/lib/bulk";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, BulkBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BULK_MAX = Math.max(1, Number(process.env.AEMULUS_BULK_MAX) || 100);
const BULK_PER_HOUR = Math.max(1, Number(process.env.AEMULUS_BULK_PER_HOUR) || 10);

/** Run a skill across many input rows. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(
      `bulk:${session.pubkey}`,
      BULK_PER_HOUR,
      60 * 60 * 1000,
      `Too many bulk runs (limit ${BULK_PER_HOUR}/hour)`,
    );
    if (limited) return limited;

    const { id } = await params;
    const skill = await getSkill(id);
    if (!skill || !(await skillAccess(skill, session.pubkey)).run) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const parsed = await readJson(req, BulkBody);
    if (!parsed.ok) return parsed.res;

    const rows = parsed.data.rows;
    if (rows.length > BULK_MAX) {
      return NextResponse.json(
        { error: `Too many rows - max ${BULK_MAX} per bulk run.` },
        { status: 400 },
      );
    }

    const quota = await getQuota(session);
    if (!quota.unlimited && rows.length > (quota.remaining ?? 0)) {
      return NextResponse.json(
        {
          error: `Bulk needs ${rows.length} runs but only ${quota.remaining} left today on the ${quota.tier} tier. Hold more $AEMU to raise it.`,
        },
        { status: 429 },
      );
    }

    const bulk = await createBulkRun(skill, rows, session.pubkey);
    return NextResponse.json({ bulkId: bulk.id, total: bulk.total });
  } catch (err) {
    logError("api/skills/bulk", err);
    return NextResponse.json(
      { error: "Bulk run failed" },
      { status: 500 },
    );
  }
}
