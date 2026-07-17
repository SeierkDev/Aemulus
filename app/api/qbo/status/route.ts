import { NextResponse } from "next/server";
import { loadConnection } from "@/lib/qbo/oauth";
import { getApViewer } from "@/lib/ap-controls/ap-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whether a QuickBooks connection exists for the caller's workspace.
export async function GET() {
  const viewer = await getApViewer().catch(() => null);
  const c = await loadConnection(viewer?.workspaceId);
  return NextResponse.json({
    connected: !!c && c.status === "connected" && !!c.accessToken,
    realm: c?.realmId ?? null,
  });
}
