import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";

const gzipAsync = promisify(gzip);

/**
 * rrweb session capture for runs.
 *
 * When enabled (AEMULUS_RRWEB=1), we inject the rrweb recorder into every page
 * the runner drives and stream its DOM-mutation events back to the server. The
 * events reconstruct the run pixel-for-pixel in the replay (far richer than the
 * per-step screenshot scrubber). Off by default and fully inert otherwise -
 * capture is always best-effort and never affects a run's outcome.
 */
export function rrwebEnabled(): boolean {
  return process.env.AEMULUS_RRWEB === "1";
}

// Bound memory/disk: a pathological page (heavy canvas, infinite mutations)
// can emit a flood. Stop collecting past these caps - the partial replay is
// still useful and the run is never impacted.
const MAX_EVENTS = 20_000;
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB of raw event JSON

// The injectable UMD recorder bundle, read once. Resolved via require.resolve so
// it works regardless of how node_modules is laid out. We only read the file as
// a string (inject it in-page) - rrweb is never imported into the server bundle.
let recorderBundle: string | null = null;
function getRecorderBundle(): string | null {
  if (recorderBundle !== null) return recorderBundle;
  try {
    const req = createRequire(import.meta.url);
    // rrweb's exports map doesn't expose the UMD subpath; resolve the package
    // main and reach the sibling bundle in its dist dir.
    const p = path.join(
      path.dirname(req.resolve("rrweb")),
      "rrweb.umd.min.cjs",
    );
    recorderBundle = readFileSync(p, "utf8");
  } catch {
    recorderBundle = ""; // resolve failed - disable capture rather than throw
  }
  return recorderBundle || null;
}

export type RrwebCapture = {
  /** Live-growing array of rrweb events (mutated as the page emits). */
  events: unknown[];
};

/**
 * Attach rrweb capture to a context BEFORE any page is created. Wires an
 * exposed binding + two init scripts (inject the recorder, then start it on a
 * deferred tick - a synchronous start deadlocks page creation). Returns the
 * live events array. No-op returning null when disabled or the bundle is
 * unavailable.
 */
export async function attachRrwebCapture(
  context: BrowserContext,
): Promise<RrwebCapture | null> {
  if (!rrwebEnabled()) return null;
  const bundle = getRecorderBundle();
  if (!bundle) return null;

  const events: unknown[] = [];
  let bytes = 0;
  let stopped = false;

  try {
    await context.exposeBinding("__aemRRWEB", (_src, ev: unknown) => {
      if (stopped) return;
      events.push(ev);
      // Cheap running size estimate; stop past the caps.
      bytes += estimateSize(ev);
      if (events.length >= MAX_EVENTS || bytes >= MAX_BYTES) stopped = true;
    });
    await context.addInitScript(bundle);
    await context.addInitScript(() => {
      // Defer: a synchronous record() here fires the first binding call during
      // page creation and deadlocks it.
      setTimeout(() => {
        const w = window as unknown as {
          rrweb?: { record: (o: unknown) => void };
          __aemRec?: boolean;
          __aemRRWEB?: (ev: unknown) => void;
        };
        if (w.rrweb && !w.__aemRec && typeof w.__aemRRWEB === "function") {
          w.__aemRec = true;
          w.rrweb.record({
            emit(ev: unknown) {
              try {
                w.__aemRRWEB!(ev);
              } catch {
                /* page tearing down */
              }
            },
            // Inline resources so the replay is self-contained and renders under
            // the app's strict CSP with no external loads.
            inlineStylesheet: true,
            inlineImages: true,
            collectFonts: true,
            recordCanvas: false,
          });
        }
      }, 0);
    });
  } catch {
    return null; // any wiring failure → skip capture, never break the run
  }
  return { events };
}

function estimateSize(ev: unknown): number {
  try {
    return JSON.stringify(ev).length;
  } catch {
    return 0;
  }
}

const REL = "rrweb.json.gz";

/** Absolute path to a run's gzipped rrweb events. */
export function rrwebPath(runsDir: string, owner: string, runId: string): string {
  return path.join(runsDir, owner, runId, REL);
}

/** Whether a run has captured rrweb events on disk. */
export function hasRrwebEvents(
  runsDir: string,
  owner: string,
  runId: string,
): boolean {
  return existsSync(rrwebPath(runsDir, owner, runId));
}

/**
 * Persist captured events (gzipped) into the run directory. Best-effort: a
 * failure or an empty/too-short stream is silently skipped.
 */
export async function saveRrwebEvents(
  runsDir: string,
  owner: string,
  runId: string,
  events: unknown[],
): Promise<void> {
  if (!events || events.length < 2) return;
  try {
    const gz = await gzipAsync(Buffer.from(JSON.stringify(events), "utf8"));
    await writeFile(rrwebPath(runsDir, owner, runId), gz);
  } catch {
    /* replay is a nicety - never fail a run over it */
  }
}
