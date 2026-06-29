/**
 * Tiny in-process metrics. Dependency-free counters for key events (runs,
 * claims, webhook deliveries, errors) so /api/health can report what the
 * process has done since boot. Cached on globalThis so HMR doesn't reset them;
 * they reset on a real restart (fine for a liveness signal — wire a real TSDB
 * via registerLogSink / the same seam when you need durable metrics).
 */
declare global {
  var __aemMetrics: Record<string, number> | undefined;
  var __aemBootAt: number | undefined;
}

const counters: Record<string, number> = (globalThis.__aemMetrics ??= {});
export const bootAt: number = (globalThis.__aemBootAt ??= Date.now());

/** Increment a named counter. */
export function incr(name: string, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

/** A copy of all counters (for /api/health). */
export function metricsSnapshot(): Record<string, number> {
  return { ...counters };
}
