import { NextResponse } from "next/server";

/**
 * Tiny in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (e.g. a wallet pubkey). Caps expensive/abusable actions (generalize, runs,
 * recording, ratings) per signed-in wallet. Per-process (fine for
 * single-instance; a multi-instance deploy would move this to a shared store -
 * see E11 shared-state residual).
 */
declare global {
  var __aemRateHits: Map<string, number[]> | undefined;
}
const hits: Map<string, number[]> = (globalThis.__aemRateHits ??= new Map());

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): RateResult {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= max) {
    const retryAfterMs = recent[0] + windowMs - now;
    hits.set(key, recent);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, remaining: max - recent.length, retryAfterMs: 0 };
}

function humanWait(ms: number): string {
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)}s`;
}

/**
 * Apply a limit and, if exceeded, return a ready-to-send 429 (else null).
 * Keeps route handlers terse: `const limited = enforceRateLimit(...); if (limited) return limited;`
 */
export function enforceRateLimit(
  key: string,
  max: number,
  windowMs: number,
  label: string,
): NextResponse | null {
  const rl = rateLimit(key, max, windowMs);
  if (rl.ok) return null;
  return NextResponse.json(
    { error: `${label} - try again in ${humanWait(rl.retryAfterMs)}.` },
    { status: 429 },
  );
}
