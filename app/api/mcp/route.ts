import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/api-keys";
import { handleMcp } from "@/lib/mcp";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  try {
    const body = await req.json();
    if (Array.isArray(body)) {
      if (body.length > 20) {
        return NextResponse.json(
          { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large (max 20)" } },
          { status: 400 },
        );
      }
      const out = (
        await Promise.all(body.map((m) => handleMcp(owner, m, scopes)))
      ).filter(Boolean);
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
