import { NextResponse } from "next/server";
import { recorder } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalize a user-typed URL into something Playwright can navigate to. */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      startUrl?: string;
    };
    if (!body.startUrl) {
      return NextResponse.json(
        { error: "startUrl is required" },
        { status: 400 },
      );
    }
    const state = await recorder.start(
      body.title ?? "",
      normalizeUrl(body.startUrl),
    );
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start" },
      { status: 409 },
    );
  }
}
