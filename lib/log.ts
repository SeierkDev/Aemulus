import { incr } from "./metrics";

/**
 * Minimal structured logger. Emits single-line JSON so logs are greppable and
 * ingestible by any aggregator. This is the single seam to wire a real error
 * monitor (Sentry, Datadog, etc.) — call registerLogSink() once at boot and
 * every log entry (and error) is forwarded there. No dependency is added until
 * you choose one.
 */
export interface LogEntry {
  level: "info" | "error";
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

type Sink = (entry: LogEntry) => void;
let sink: Sink | null = null;

/** Register an external log/error sink (e.g. forward errors to Sentry). */
export function registerLogSink(fn: Sink | null): void {
  sink = fn;
}

function emit(
  level: "info" | "error",
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  const line = JSON.stringify({
    level,
    scope,
    message,
    ...meta,
    ts: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else console.log(line);
  // Forward to an external monitor if one is registered (never let it throw).
  if (sink) {
    try {
      sink({ level, scope, message, meta });
    } catch {
      /* a broken sink must not break the app */
    }
  }
}

export function logInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  emit("info", scope, message, meta);
}

export function logError(scope: string, err: unknown, meta?: Record<string, unknown>) {
  incr("errors");
  emit("error", scope, err instanceof Error ? err.message : String(err), {
    ...meta,
    stack: err instanceof Error ? err.stack : undefined,
  });
}
