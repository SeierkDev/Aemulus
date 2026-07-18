import { NextResponse } from "next/server";
import { verifyDisclosure } from "@/lib/commitment";
import { getRun } from "@/lib/runs";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

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
  // Unauthenticated: rate-limit and cap the body BEFORE buffering it. The per-IP
  // key uses X-Forwarded-For (spoofable to spread across buckets), so also enforce
  // a fixed global cap that no header trick can bypass.
  const globalLimited = enforceRateLimit("disclose-verify:global", 600, 60_000, "Service busy — try again shortly.");
  if (globalLimited) return globalLimited;
  const limited = enforceRateLimit(`disclose-verify:${clientIp(req)}`, 30, 60_000, "Too many requests");
  if (limited) return limited;
  if (Number(req.headers.get("content-length") || 0) > 512 * 1024) {
    return NextResponse.json({ error: "Body too large." }, { status: 413 });
  }
  try {
    const b = await req.json();
    const proof = b?.proof;
    const okShape =
      str(b?.runId, 120) &&
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

    // BIND the proof to a real run: the bundle's root MUST equal that run's
    // committed (on-chain anchored) root. Without this, a caller could prove
    // membership in a self-chosen tree and the "part of the anchored run" claim
    // would be meaningless. Membership alone is necessary but NOT sufficient.
    let bound = false;
    if (okShape) {
      const run = await getRun(b.runId);
      bound = !!run?.commitmentRoot && b.root === run.commitmentRoot;
    }

    const valid = bound && verifyDisclosure(b.root, b.field, b.value, b.salt, proof);
    return NextResponse.json({
      valid: !!valid,
      // Distinguish "cryptographically valid but not tied to this run" from a
      // genuine proof, so the UI never shows a false "part of the run" claim.
      bound,
      runId: valid ? b.runId : undefined,
    });
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
}
