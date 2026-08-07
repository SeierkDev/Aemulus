import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { MarketBrowser, type MarketItem } from "@/components/MarketBrowser";
import {
  publishedSkillsByIds,
  categorize,
  templateTool,
} from "@/lib/skills";
import { collectionSkillIds, getCollectionBySlug } from "@/lib/collections";
import type { Skill } from "@/lib/types";
import { getReputationBatch } from "@/lib/reputation";
import { isVerified } from "@/lib/moderation";

export const dynamic = "force-dynamic";

/**
 * One curated collection.
 *
 * The slug existed before this page did: it was stored, uniquely indexed and
 * passed through to the shelf, and nothing resolved it — so a collection was
 * something you could be shown but never sent to. A collection you cannot link
 * to is most of the point of a collection.
 */
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const collection = await getCollectionBySlug(slug);
  if (!collection) notFound();

  const ids = await collectionSkillIds(collection.id);
  const byId = await publishedSkillsByIds(ids);
  // Curated order, not the order the database felt like returning.
  const skills = ids
    .map((id) => byId.get(id))
    .filter((s): s is Skill => s !== undefined);
  const rep = await getReputationBatch(skills.map((s) => s.id));

  const items: MarketItem[] = skills.map((s) => {
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
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <Link
          href="/market"
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3 hover:text-ink-2"
        >
          &larr; Marketplace
        </Link>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{collection.title}</h1>
            {collection.blurb && (
              <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{collection.blurb}</p>
            )}
          </div>
          <Badge>{items.length} shown</Badge>
        </div>

        {items.length === 0 ? (
          // A collection can empty out under a curator when its skills are
          // unpublished or taken down. Say so rather than rendering a bare grid.
          <p className="mt-8 text-sm text-ink-2">
            Nothing in this collection is published right now.
          </p>
        ) : (
          <MarketBrowser items={items} />
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}
