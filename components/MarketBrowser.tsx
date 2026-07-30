"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, cx } from "./ui";
import { Stars } from "./Stars";
import { short } from "@/lib/format";

export interface MarketItem {
  id: string;
  name: string;
  description: string;
  owner: string;
  runCount: number;
  category: string;
  avgStars: number;
  ratingCount: number;
  successRate: number;
  runs: number;
  verified: boolean;
  /** Tool name if this is a starter template (not runnable as-is), else null. */
  template?: string | null;
}

const inputCls =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3.5 py-2.5 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Searchable, category-filterable marketplace grid. Search is server-driven
 *  (debounced ?q=) so it covers ALL published skills, not just the first page;
 *  the category pills refine the returned set client-side. */
export function MarketBrowser({
  items,
  initialQuery = "",
}: {
  items: MarketItem[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState("All");
  const firstRun = useRef(true);

  // Debounce the query into the URL; the server re-queries across all skills.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      const trimmed = q.trim();
      router.replace(
        trimmed ? `/market?q=${encodeURIComponent(trimmed)}` : "/market",
        { scroll: false },
      );
    }, 350);
    return () => clearTimeout(t);
  }, [q, router]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
    return ["All", ...[...counts.keys()].sort()];
  }, [items]);

  // Effective category falls back to "All" when the selected one isn't in the
  // current (search) results - so a stale pill can't hide valid matches.
  const activeCat = categories.includes(cat) ? cat : "All";

  const filtered = useMemo(
    () => items.filter((it) => activeCat === "All" || it.category === activeCat),
    [items, activeCat],
  );

  return (
    <div className="mt-6">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search skills…"
        aria-label="Search skills"
        className={inputCls}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            aria-pressed={c === activeCat}
            className={cx(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              c === activeCat
                ? "border-border-strong bg-elevated text-ink"
                : "border-border bg-surface-2 text-ink-2 hover:text-ink",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {filtered.length === 0 && (
          <Card className="p-8 text-center text-sm text-ink-2 md:col-span-2">
            No skills match.
          </Card>
        )}
        {filtered.map((it) => (
          <Link key={it.id} href={`/market/${it.id}`}>
            <Card className="flex h-full flex-col p-5 transition-colors hover:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium tracking-tight">
                  {it.name}
                  {it.verified && (
                    <span
                      className="ml-1.5 align-middle text-xs text-ink-3"
                      role="img"
                      aria-label="verified creator"
                    >
                      ✓
                    </span>
                  )}
                </h3>
                {!it.template && it.ratingCount > 0 && (
                  <span className="shrink-0 text-xs">
                    <Stars value={it.avgStars} />{" "}
                    <span className="text-ink-3">({it.ratingCount})</span>
                  </span>
                )}
                {it.template && (
                  <span className="shrink-0 rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-ink-3">
                    Template
                  </span>
                )}
              </div>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-2">
                {it.description}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide">
                  {it.category}
                </span>
                <span className="mono">by {short(it.owner)}</span>
                {it.template ? (
                  <>
                    <span>·</span>
                    <span>record your own on {it.template}</span>
                  </>
                ) : (
                  <>
                    <span>·</span>
                    <span>{it.runCount} runs</span>
                    {it.runs > 0 && (
                      <>
                        <span>·</span>
                        <span>{Math.round(it.successRate * 100)}% success</span>
                      </>
                    )}
                  </>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
