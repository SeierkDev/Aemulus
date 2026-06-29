import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { payoutsEnabled } from "@/lib/payout";
import { claimEarnings } from "@/lib/earnings";
import { withIdempotency } from "@/lib/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Claim a creator's accrued earnings (on-chain payout). */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!payoutsEnabled()) {
    return NextResponse.json(
      { error: "Claims open at launch." },
      { status: 400 },
    );
  }
  try {
    // Idempotent: a retry with the same Idempotency-Key replays the original
    // claim (the same tx signature) rather than risking a second payout.
    const { status, body } = await withIdempotency(
      session.pubkey,
      "earnings/claim",
      req.headers.get("idempotency-key"),
      async () => {
        const r = await claimEarnings(session.pubkey);
        return { status: 200, body: { ok: true, ...r } };
      },
    );
    return NextResponse.json(body, { status });
  } catch (err) {
    logError("api/earnings/claim", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Claim failed" },
      { status: 500 },
    );
  }
}
