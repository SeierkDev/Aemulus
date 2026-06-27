import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRecorder } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ id: "", status: "idle", actions: [] });
  }
  return NextResponse.json(getRecorder(session.pubkey).snapshot());
}
