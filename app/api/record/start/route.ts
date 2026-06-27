import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { assertSafeUrl } from "@/lib/safe-url";
import { recorder } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalize a user-typed URL into something Playwright can navigate to. */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t) || t.startsWith("data:")) return t;
  return `https://${t}`;
}

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
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
    const url = normalizeUrl(body.startUrl);
    try {
      await assertSafeUrl(url);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Unsafe URL" },
        { status: 400 },
      );
    }
    const state = await recorder.start(body.title ?? "", url, session.pubkey);
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start" },
      { status: 409 },
    );
  }
}
