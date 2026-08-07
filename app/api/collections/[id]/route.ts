import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, CollectionUpdateBody, CollectionSkillBody } from "@/lib/validate";
import {
  addToCollection,
  deleteCollection,
  isCurator,
  removeFromCollection,
  updateCollection,
} from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Curator-only edits to one collection.
 *
 * Every handler answers 404 rather than 403 to a non-curator, for the same
 * reason the create route does: the existence of an editorial layer is not
 * something an arbitrary wallet needs confirmed.
 */
async function gate(pubkeyNeeded = true) {
  const session = await requireAccess();
  if (!session) {
    return { res: NextResponse.json({ error: "Not authorized" }, { status: 401 }) };
  }
  if (pubkeyNeeded && !isCurator(session.pubkey)) {
    return { res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const limited = enforceRateLimit(`curate:${session.pubkey}`, 30, 60_000, "Too many edits");
  if (limited) return { res: limited };
  return { session };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate();
    if (g.res) return g.res;
    const { id } = await params;
    const body = await readJson(req, CollectionUpdateBody);
    if (!body.ok) return body.res;
    const ok = await updateCollection(id, body.data);
    if (!ok) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("collections.update", e);
    return NextResponse.json({ error: "Failed to update collection" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate();
    if (g.res) return g.res;
    const { id } = await params;
    // A skillId in the body means "remove this one member"; NO body at all means
    // "delete the whole collection". Kept on one verb so a curator UI does not
    // need two shapes for two kinds of removal.
    //
    // The emptiness check is on the raw text, deliberately. Falling back to the
    // whole-collection delete whenever the schema failed to parse would turn a
    // malformed remove-one-member call — {skillId:""}, a typo'd key — into a
    // silent delete of everything in the collection. An invalid body has to be
    // an error, not a broader action than the caller asked for.
    const raw = (await req.text()).trim();
    if (raw) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        // Unparseable is still "they meant to send something" — 400, not a
        // fall-through to deleting the collection, and not a 500 either.
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
      const parsed = CollectionSkillBody.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
      const ok = await removeFromCollection(id, parsed.data.skillId);
      return NextResponse.json({ ok });
    }
    const ok = await deleteCollection(id);
    if (!ok) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("collections.delete", e);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

/** Add a published skill to this collection (or move one already in it). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate();
    if (g.res) return g.res;
    const { id } = await params;
    const body = await readJson(req, CollectionSkillBody);
    if (!body.ok) return body.res;
    const ok = await addToCollection(id, body.data.skillId, body.data.position ?? 0);
    if (!ok) {
      return NextResponse.json(
        { error: "Collection or published skill not found, or the collection is full" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("collections.add", e);
    return NextResponse.json({ error: "Failed to add skill" }, { status: 500 });
  }
}
