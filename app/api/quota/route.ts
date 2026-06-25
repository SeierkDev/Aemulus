import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getQuota } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ quota: await getQuota(session) });
}
