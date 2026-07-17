import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { assertSafeUrl } from "@/lib/safe-url";
import { getRecorder } from "@/lib/recorder";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, RecordStartBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD_PER_HOUR = Math.max(
  1,
  Number(process.env.AEMULUS_RECORD_PER_HOUR) || 30,
);

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
    const limited = enforceRateLimit(
      `rec:${session.pubkey}`,
      RECORD_PER_HOUR,
      60 * 60 * 1000,
      `Too many recordings (limit ${RECORD_PER_HOUR}/hour)`,
    );
    if (limited) return limited;
    const parsed = await readJson(req, RecordStartBody);
    if (!parsed.ok) return parsed.res;
    const body = parsed.data;
    const url = normalizeUrl(body.startUrl);
    try {
      await assertSafeUrl(url);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Unsafe URL" },
        { status: 400 },
      );
    }
    const state = await getRecorder(session.pubkey).start(
      body.title ?? "",
      url,
      session.pubkey,
    );
    return NextResponse.json(state);
  } catch {
    return NextResponse.json(
      { error: "Couldn’t start the recording." },
      { status: 409 },
    );
  }
}
