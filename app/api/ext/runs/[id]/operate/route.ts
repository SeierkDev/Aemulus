import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/api-keys";
import { getRun } from "@/lib/runs";
import { operatorChooseSelector, type Candidate } from "@/lib/operate";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vision fallback for extension runs: when a recorded selector no longer matches
// in the user's browser, the extension sends the page's candidate elements + a
// screenshot here; the operator (Claude, server-side — the key never leaves the
// server) picks the element and returns a selector + confidence. The extension
// retries the step with it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await apiKeyAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
    }
    const { id } = await params;
    const run = await getRun(id);
    if (!run || run.owner !== auth.owner) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (["completed", "failed", "needs_review"].includes(run.status)) {
      return NextResponse.json({ error: "Run already finished" }, { status: 409 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const intent = typeof body?.intent === "string" ? body.intent.slice(0, 300) : "";
    const action = typeof body?.action === "string" ? body.action.slice(0, 20) : "click";
    const shot = typeof body?.screenshot === "string" ? body.screenshot : "";
    const base64 = shot.replace(/^data:image\/[a-z]+;base64,/, "");
    if (!base64) {
      return NextResponse.json({ selector: "", confidence: 0, tokensIn: 0, tokensOut: 0 });
    }

    const candidates: Candidate[] = Array.isArray(body?.candidates)
      ? (body!.candidates as unknown[])
          .slice(0, 80)
          .map((c) => (c ?? {}) as Record<string, unknown>)
          .filter((c) => typeof c.selector === "string")
          .map((c) => ({
            selector: String(c.selector).slice(0, 400),
            tag: typeof c.tag === "string" ? c.tag.slice(0, 40) : "",
            text: typeof c.text === "string" ? c.text.slice(0, 80) : "",
            name: typeof c.name === "string" ? c.name.slice(0, 80) : "",
            role: typeof c.role === "string" ? c.role.slice(0, 40) : undefined,
          }))
      : [];

    try {
      const decision = await operatorChooseSelector({
        intent,
        action,
        candidates,
        screenshotBase64: base64,
      });
      return NextResponse.json({
        selector: decision.selector,
        confidence: decision.confidence,
        tokensIn: decision.tokensIn,
        tokensOut: decision.tokensOut,
      });
    } catch (e) {
      // No API key configured, or the model errored — no rescue available.
      logError("api/ext/runs/operate", e);
      return NextResponse.json({ selector: "", confidence: 0, tokensIn: 0, tokensOut: 0 });
    }
  } catch (e) {
    logError("api/ext/runs/operate.outer", e);
    return NextResponse.json({ error: "Operate failed." }, { status: 500 });
  }
}
