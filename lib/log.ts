/**
 * Minimal structured logger. Emits single-line JSON so logs are greppable and
 * ingestible by any aggregator. This is the single seam to wire a real error
 * monitor (Sentry, etc.) into later — route catches call logError here.
 */
function emit(level: "info" | "error", scope: string, message: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    scope,
    message,
    ...meta,
    ts: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

export function logInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  emit("info", scope, message, meta);
}

export function logError(scope: string, err: unknown, meta?: Record<string, unknown>) {
  emit("error", scope, err instanceof Error ? err.message : String(err), {
    ...meta,
    stack: err instanceof Error ? err.stack : undefined,
  });
  // Hook a real monitor here, e.g. Sentry.captureException(err).
}
