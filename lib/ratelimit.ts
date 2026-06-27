/**
 * Tiny in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (e.g. a wallet pubkey). Used to cap expensive actions like generalize so a
 * signed-in user can't spam Claude calls. Per-process (fine for single-instance;
 * a multi-instance deploy would move this to a shared store).
 */
declare global {
  var __mimicRateHits: Map<string, number[]> | undefined;
}
const hits: Map<string, number[]> = (globalThis.__mimicRateHits ??= new Map());

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
