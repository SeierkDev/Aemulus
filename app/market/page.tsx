import { Badge } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { MarketBrowser, type MarketItem } from "@/components/MarketBrowser";
import {
  CuratedShelf,
  type ShelfCollection,
  type ShelfSpotlight,
} from "@/components/CuratedShelf";
import {
  listPublishedSkills,
  searchPublishedSkills,
  publishedSkillsByIds,
  categorize,
  templateTool,
} from "@/lib/skills";
import { listCollectionsWithSkills, listSpotlights } from "@/lib/collections";
import type { Skill } from "@/lib/types";
import { getReputationBatch } from "@/lib/reputation";
import { isVerified } from "@/lib/moderation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Skill marketplace - Aemulus",
  description:
    "Skills published by the community. Run any of them on your own inputs, no recording required.",
};

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  // Search hits ALL published skills; the default list shows the top by usage.
  const skills = query
    ? await searchPublishedSkills(query)
    : await listPublishedSkills();

  // The curated shelf is only fetched for a bare landing. Someone who typed has
  // said what they came for, and editorial picks pushing their results down the
  // page is the failure mode this feature would otherwise introduce.
  const [spotlightRows, collectionRows] = query
    ? [[], []]
    : await Promise.all([listSpotlights(), listCollectionsWithSkills()]);

  // One extra query for every curated skill that isn't already in the list, so
  // a collection can point at something outside the top-by-usage page without
  // the shelf needing its own N lookups.
  const haveIds = new Set(skills.map((s) => s.id));
  const wantedIds = [
    ...spotlightRows.map((s) => s.skillId),
    ...collectionRows.flatMap((c) => c.skillIds),
  ].filter((sid) => !haveIds.has(sid));
  const extra = await publishedSkillsByIds(wantedIds);

  const byId = new Map<string, Skill>(skills.map((s) => [s.id, s]));
  for (const [sid, s] of extra) byId.set(sid, s);

  // Reputation for everything on the page, curated rows included, in one batch.
  const rep = await getReputationBatch([...byId.keys()]);

  const toItem = (s: Skill): MarketItem => {
    const r = rep.get(s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      owner: s.owner,
      runCount: s.runCount,
      category: categorize(s.name, s.description),
      avgStars: r?.avgStars ?? 0,
      ratingCount: r?.ratingCount ?? 0,
      successRate: r?.successRate ?? 0,
      runs: r?.runs ?? 0,
      verified: isVerified(s.owner),
      template: templateTool(s),
    };
  };

  const items: MarketItem[] = skills.map(toItem);

  const spotlights: ShelfSpotlight[] = spotlightRows
    .map((sp) => {
      const s = byId.get(sp.skillId);
      return s ? { item: toItem(s), blurb: sp.blurb } : null;
    })
    .filter((x): x is ShelfSpotlight => x !== null);

  const collections: ShelfCollection[] = collectionRows
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      blurb: c.blurb,
      items: c.skillIds
        .map((sid) => byId.get(sid))
        .filter((s): s is Skill => s !== undefined)
        .map(toItem),
    }))
    // A collection whose every member vanished between the two queries would
    // otherwise render as a heading with nothing under it.
    .filter((c) => c.items.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Skill marketplace
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              Skills published by the community. Run any of them on your own
              inputs - no recording required.
            </p>
          </div>
          <Badge>{query ? `${skills.length} results` : `${skills.length} shown`}</Badge>
        </div>

        <CuratedShelf spotlights={spotlights} collections={collections} />

        {(spotlights.length > 0 || collections.length > 0) && (
          <h2 className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
            Everything
          </h2>
        )}

        <MarketBrowser items={items} initialQuery={query} />
      </div>
      <div className="py-10" />
    </div>
  );
}
