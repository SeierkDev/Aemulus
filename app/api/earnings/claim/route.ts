import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { payoutsEnabled } from "@/lib/payout";
import { claimEarnings } from "@/lib/earnings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Claim a creator's accrued earnings (on-chain payout). */
export async function POST() {
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
    const r = await claimEarnings(session.pubkey);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    logError("api/earnings/claim", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Claim failed" },
      { status: 500 },
    );
  }
}
