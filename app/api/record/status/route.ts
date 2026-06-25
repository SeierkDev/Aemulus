import { NextResponse } from "next/server";
import { recorder } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(recorder.snapshot());
}
