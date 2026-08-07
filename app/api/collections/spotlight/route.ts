import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, SpotlightBody } from "@/lib/validate";
import { clearSpotlight, isCurator, listSpotlights, setSpotlight } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current spotlight, already filtered to skills that are still published. */
export async function GET() {
  try {
    return NextResponse.json({ spotlights: await listSpotlights() });
  } catch (e) {
    logError("spotlight.list", e);
    return NextResponse.json({ error: "Failed to load spotlight" }, { status: 500 });
  }
}

async function gate() {
  const session = await requireAccess();
  if (!session) {
    return { res: NextResponse.json({ error: "Not authorized" }, { status: 401 }) };
  }
  if (!isCurator(session.pubkey)) {
    return { res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const limited = enforceRateLimit(`curate:${session.pubkey}`, 30, 60_000, "Too many edits");
  if (limited) return { res: limited };
  return { session };
}

/** Feature a published skill, with an editorial line. */
export async function POST(req: Request) {
  try {
    const g = await gate();
    if (g.res) return g.res;
    const body = await readJson(req, SpotlightBody);
    if (!body.ok) return body.res;
    const ok = await setSpotlight(
      body.data.skillId,
      body.data.blurb ?? "",
      body.data.position ?? 0,
    );
    if (!ok) {
      return NextResponse.json(
        { error: "Published skill not found, or the spotlight is full" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("spotlight.set", e);
    return NextResponse.json({ error: "Failed to set spotlight" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const g = await gate();
    if (g.res) return g.res;
    const body = await readJson(req, SpotlightBody);
    if (!body.ok) return body.res;
    return NextResponse.json({ ok: await clearSpotlight(body.data.skillId) });
  } catch (e) {
    logError("spotlight.clear", e);
    return NextResponse.json({ error: "Failed to clear spotlight" }, { status: 500 });
  }
}
