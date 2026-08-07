import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, CollectionCreateBody } from "@/lib/validate";
import { publishedSkillsByIds } from "@/lib/skills";
import {
  createCollection,
  isCurator,
  listCollectionsWithSkills,
  listSpotlights,
} from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The curated shelf: spotlights + collections, with only the skills that are
 * still published. Public, because the marketplace is.
 */
export async function GET() {
  try {
    const [spotlights, collections] = await Promise.all([
      listSpotlights(),
      listCollectionsWithSkills(),
    ]);
    // Resolved to something renderable. Returning bare ids meant any consumer —
    // the docs example, an MCP client, anyone building on the API — had to make
    // one more request per card before it could draw anything, which is not an
    // endpoint so much as a lookup table.
    const byId = await publishedSkillsByIds([
      ...spotlights.map((s) => s.skillId),
      ...collections.flatMap((c) => c.skillIds),
    ]);
    const card = (id: string) => {
      const s = byId.get(id);
      return s
        ? { id: s.id, name: s.name, description: s.description, owner: s.owner, runCount: s.runCount }
        : null;
    };
    return NextResponse.json({
      spotlights: spotlights
        .map((sp) => ({ ...card(sp.skillId), blurb: sp.blurb }))
        .filter((sp) => sp.id),
      collections: collections.map((c) => ({
        slug: c.slug,
        title: c.title,
        blurb: c.blurb,
        url: `/market/c/${c.slug}`,
        skills: c.skillIds.map(card).filter(Boolean),
      })),
    });
  } catch (e) {
    logError("collections.list", e);
    return NextResponse.json({ error: "Failed to load collections" }, { status: 500 });
  }
}

/** Create a collection. Curators only. */
export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    // Not 403: a wallet that is not a curator should not learn that curation
    // exists as a thing it is being kept out of.
    if (!isCurator(session.pubkey)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const limited = enforceRateLimit(`curate:${session.pubkey}`, 30, 60_000, "Too many edits");
    if (limited) return limited;

    const body = await readJson(req, CollectionCreateBody);
    if (!body.ok) return body.res;

    const created = await createCollection({
      slug: body.data.slug,
      title: body.data.title,
      blurb: body.data.blurb ?? "",
      position: body.data.position ?? 0,
    });
    if (!created) {
      return NextResponse.json(
        { error: "Need a usable slug and title, and the slug must be free" },
        { status: 400 },
      );
    }
    return NextResponse.json({ collection: created });
  } catch (e) {
    logError("collections.create", e);
    return NextResponse.json({ error: "Failed to create collection" }, { status: 500 });
  }
}
