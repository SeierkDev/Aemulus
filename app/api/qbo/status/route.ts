import { NextResponse } from "next/server";
import { loadConnection } from "@/lib/qbo/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whether a QuickBooks connection exists (drives the UI connect gate).
export async function GET() {
  const c = await loadConnection();
  return NextResponse.json({
    connected: !!c && c.status === "connected" && !!c.accessToken,
    realm: c?.realmId ?? null,
  });
}
