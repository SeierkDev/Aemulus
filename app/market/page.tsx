import { Badge } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { MarketBrowser, type MarketItem } from "@/components/MarketBrowser";
import { listPublishedSkills, categorize } from "@/lib/skills";
import { getReputationBatch } from "@/lib/reputation";
import { isVerified } from "@/lib/moderation";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const skills = await listPublishedSkills();
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
    };
  });

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
          <Badge>{skills.length} published</Badge>
        </div>

        <MarketBrowser items={items} />
      </div>
      <div className="py-10" />
    </div>
  );
}
