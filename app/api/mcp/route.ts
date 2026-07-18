import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/api-keys";
import { rateLimit } from "@/lib/ratelimit";
import { handleMcp } from "@/lib/mcp";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MCP_PER_MIN = Math.max(1, Number(process.env.AEMULUS_MCP_PER_MIN) || 60);
const MAX_BODY_BYTES = 256 * 1024; // JSON-RPC requests are small; reject giant bodies

/**
 * MCP endpoint (JSON-RPC over HTTP, Streamable-HTTP style: JSON for requests,
 * 202 for notifications). Auth: Authorization: Bearer aem_live_…
 */
export async function POST(req: Request) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
      { status: 401 },
    );
  }
  const { owner, scopes } = auth;

  // Rate-limit + size-cap BEFORE buffering the body, so an authed key can't hammer
  // the (otherwise unmetered) pre-parse for a memory-exhaustion DoS.
  if (!rateLimit(`mcp:${owner}`, MCP_PER_MIN, 60_000).ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests" } },
      { status: 429 },
    );
  }
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } },
      { status: 413 },
    );
  }

  try {
    const body = await req.json();
    if (Array.isArray(body)) {
      if (body.length > 20) {
        return NextResponse.json(
          { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large (max 20)" } },
          { status: 400 },
        );
      }
      // allSettled: one element throwing must NOT collapse the whole batch (correct
      // JSON-RPC per-element semantics). handleMcp already returns error OBJECTS for
      // tool failures, so a reject here is an unexpected internal error.
      const settled = await Promise.allSettled(body.map((m) => handleMcp(owner, m, scopes)));
      const out = settled
        .map((s) =>
          s.status === "fulfilled"
            ? s.value
            : { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } },
        )
        .filter(Boolean);
      return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
    }
    const res = await handleMcp(owner, body, scopes);
    if (!res) return new NextResponse(null, { status: 202 }); // notification
    return NextResponse.json(res);
  } catch (err) {
    logError("api/mcp", err);
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }
}
