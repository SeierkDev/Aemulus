import { NextResponse } from "next/server";
import { verifyDisclosure } from "@/lib/commitment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public: verify a selective-disclosure bundle against a committed root. No
 * auth, no private data - the caller cross-checks `root` against the run's
 * on-chain anchored receipt.
 */
// This is a public, unauthenticated endpoint, so bound every field before doing
// any work (no giant strings or unbounded proof arrays).
const str = (s: unknown, max: number): s is string =>
  typeof s === "string" && s.length <= max;

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const proof = b?.proof;
    const okShape =
      str(b?.root, 128) &&
      str(b?.field, 256) &&
      str(b?.value, 20_000) &&
      str(b?.salt, 128) &&
      proof &&
      Array.isArray(proof.siblings) &&
      proof.siblings.length <= 256 &&
      proof.siblings.every(
        (s: unknown) =>
          typeof s === "object" &&
          s !== null &&
          str((s as { hash?: unknown }).hash, 128) &&
          typeof (s as { left?: unknown }).left === "boolean",
      );
    const valid = okShape && verifyDisclosure(b.root, b.field, b.value, b.salt, proof);
    return NextResponse.json({ valid: !!valid });
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
}
