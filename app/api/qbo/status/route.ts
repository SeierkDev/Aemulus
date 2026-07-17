import { NextResponse } from "next/server";
import { loadConnection } from "@/lib/qbo/oauth";
import { getApSession } from "@/lib/ap-controls/ap-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whether a QuickBooks connection exists for the caller's workspace.
export async function GET() {
  const session = await getApSession().catch(() => null);
  const c = await loadConnection(session?.workspaceId);
  return NextResponse.json({
    connected: !!c && c.status === "connected" && !!c.accessToken,
    realm: c?.realmId ?? null,
  });
}
