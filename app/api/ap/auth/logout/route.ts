import { NextResponse } from "next/server";
import { clearApSessionCookie } from "@/lib/ap-controls/ap-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearApSessionCookie(res);
  return res;
}
