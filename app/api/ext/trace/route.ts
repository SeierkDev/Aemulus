import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/api-keys";
import { createDemonstration } from "@/lib/demonstrations";
import { logError } from "@/lib/log";
import type { RecordedAction, ActionType } from "@/lib/types";
import { WATCH_OPS } from "@/lib/watches";

/** Ops a capture may be recorded with. Anything else is dropped rather than
 *  stored, so a client cannot invent an operator the evaluator does not know. */
const KNOWN_OPS = new Set<string>(WATCH_OPS);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Aemulus browser extension records a task in the user's OWN browser (so
// it's already logged in and looks like a real user) and posts the captured
// trace here. We authenticate with the user's API key and turn the trace into a
// demonstration - identical to a server-side recording - which the site then
// generalizes into a skill via the existing pipeline.

const ACTION_TYPES = new Set<ActionType>([
  "navigate",
  "click",
  "input",
  "select",
  "key",
  "submit",
  // Without this the filter below drops every capture the extension records —
  // silently, because a filtered action leaves no trace of having existed. The
  // extension half of capture mode did nothing at all until this was added.
  "extract",
]);
const MAX_ACTIONS = 1000;

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;

export async function POST(req: Request) {
  try {
    const auth = await apiKeyAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
    }
    const body: unknown = await req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.actions)) {
      return NextResponse.json({ error: "Expected an 'actions' array" }, { status: 400 });
    }

    const title = str(b.title, 200) ?? "";
    const startUrl = str(b.startUrl, 2000) ?? null;

    const trace: RecordedAction[] = (b.actions as unknown[])
      .slice(0, MAX_ACTIONS)
      .map((raw) => (raw ?? {}) as Record<string, unknown>)
      .filter((a) => ACTION_TYPES.has(a.type as ActionType))
      .map((a, idx): RecordedAction => {
        const sensitive = a.sensitive === true;
        const selectors = Array.isArray(a.selectors)
          ? (a.selectors as unknown[]).filter((s) => typeof s === "string").slice(0, 10) as string[]
          : [];
        return {
          idx,
          type: a.type as ActionType,
          url: str(a.url, 2000) ?? "",
          ts: typeof a.ts === "number" && Number.isFinite(a.ts) ? a.ts : Date.now(),
          selectors,
          tag: str(a.tag, 40),
          role: str(a.role, 40),
          name: str(a.name, 200),
          text: str(a.text, 200),
          // Never persist a secret's value - record it empty + flagged so the
          // generalizer treats it as a required per-run input (same as server capture).
          value: sensitive ? "" : str(a.value, 2000),
          sensitive,
          key: str(a.key, 20),
          // The name the user gave a capture. Dropping it here would not lose
          // the capture, only its name — which then silently falls back to a
          // slug of the element's label and looks like the naming field is
          // broken rather than unread.
          outputKey: str(a.outputKey, 120),
          // The watch rule set while recording. Dropping it here would not lose
          // the capture, only the answer to "when do you care" — which is the
          // whole point of asking at record time rather than later.
          watchOp: KNOWN_OPS.has(String(a.watchOp)) ? String(a.watchOp) : undefined,
          watchValue: str(a.watchValue, 2000),
        };
      });

    if (trace.length === 0) {
      return NextResponse.json({ error: "No usable actions were captured." }, { status: 400 });
    }

    const demo = await createDemonstration({
      owner: auth.owner,
      title: title || "Recorded task",
      startUrl,
      trace,
    });
    return NextResponse.json({ demonstrationId: demo.id, steps: trace.length });
  } catch (e) {
    logError("api/ext/trace", e);
    return NextResponse.json({ error: "Failed to save the recording." }, { status: 500 });
  }
}
