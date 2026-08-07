import Link from "next/link";
import { Card } from "./ui";
import { Stars } from "./Stars";
import type { MarketItem } from "./MarketBrowser";

export interface ShelfCollection {
  id: string;
  slug: string;
  title: string;
  blurb: string;
  items: MarketItem[];
}

export interface ShelfSpotlight {
  item: MarketItem;
  blurb: string;
}

/**
 * The curated shelf above the searchable grid.
 *
 * Shown only when someone lands without a query. The moment they type, they
 * have told us what they came for and editorial picks are in the way — so the
 * market page drops this entirely rather than pushing results below the fold.
 */
export function CuratedShelf({
  spotlights,
  collections,
}: {
  spotlights: ShelfSpotlight[];
  collections: ShelfCollection[];
}) {
  if (!spotlights.length && !collections.length) return null;

  return (
    <div className="mt-8 flex flex-col gap-9">
      {spotlights.length > 0 && (
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
            Spotlight
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {spotlights.map((s) => (
              <Link key={s.item.id} href={`/market/${s.item.id}`} className="group">
                <Card className="h-full border-border-strong bg-surface-2 p-5 transition-colors group-hover:border-ink-3">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-base font-semibold tracking-tight">{s.item.name}</h3>
                    {s.item.verified && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                        verified
                      </span>
                    )}
                  </div>
                  {/* The curator's line, not the skill's own description — the
                      point of a spotlight is a human saying why this one. */}
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">
                    {s.blurb || s.item.description}
                  </p>
                  <div className="mt-4 flex items-center gap-3 text-xs text-ink-3">
                    <Stars value={s.item.avgStars} />
                    <span className="font-mono">{s.item.runCount} runs</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {collections.map((c) => (
        <section key={c.id}>
          <div className="flex items-baseline gap-3">
            {/* The heading is the link to the collection — a curated group you
                cannot send someone to is most of the point missing. */}
            <Link href={`/market/c/${c.slug}`} className="group/head">
              <h2 className="text-base font-semibold tracking-tight group-hover/head:text-ink-2">
                {c.title}
              </h2>
            </Link>
            {c.blurb && <p className="text-sm text-ink-2">{c.blurb}</p>}
            <Link
              href={`/market/c/${c.slug}`}
              className="ml-auto font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3 hover:text-ink-2"
            >
              All &rarr;
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {c.items.map((it) => (
              <Link key={it.id} href={`/market/${it.id}`} className="group">
                <Card className="h-full p-4 transition-colors group-hover:border-ink-3">
                  <h3 className="text-sm font-semibold tracking-tight">{it.name}</h3>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-2">
                    {it.description}
                  </p>
                  <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
                    <span className="font-mono">{it.category}</span>
                    <span className="font-mono">{it.runCount} runs</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
