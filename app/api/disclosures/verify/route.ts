import { NextResponse } from "next/server";
import { verifyDisclosure } from "@/lib/commitment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public: verify a selective-disclosure bundle against a committed root. No
 * auth, no private data - the caller cross-checks `root` against the run's
 * on-chain anchored receipt.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const valid =
      typeof b?.root === "string" &&
      typeof b?.field === "string" &&
      typeof b?.value === "string" &&
      typeof b?.salt === "string" &&
      b?.proof &&
      verifyDisclosure(b.root, b.field, b.value, b.salt, b.proof);
    return NextResponse.json({ valid: !!valid });
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
}
