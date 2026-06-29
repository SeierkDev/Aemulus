import Link from "next/link";
import { Card } from "@/components/ui";
import { Stars } from "@/components/Stars";
import type { Skill, SkillReputation } from "@/lib/types";

/** Marketplace teaser: real published skills with their trust signals. */
export function PopularSkills({
  skills,
  rep,
}: {
  skills: Skill[];
  rep: Map<string, SkillReputation>;
}) {
  if (skills.length === 0) return null;
  return (
    <section className="border-t border-border py-16">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Popular skills
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">
            Published by the community - run any of them on your own inputs.
          </p>
        </div>
        <Link href="/market" className="text-sm text-ink-3 hover:text-ink">
          Explore all →
        </Link>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {skills.map((s) => {
          const r = rep.get(s.id);
          return (
            <Link key={s.id} href={`/market/${s.id}`}>
              <Card className="flex h-full flex-col p-5 transition-colors hover:bg-surface-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{s.name}</h3>
                  {r && r.ratingCount > 0 && (
                    <span className="shrink-0 text-xs">
                      <Stars value={r.avgStars} />
                    </span>
                  )}
                </div>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-3">
                  {s.description}
                </p>
                <div className="mono mt-3 flex items-center gap-2 text-xs text-ink-3">
                  <span>{s.runCount} runs</span>
                  {r && r.runs > 0 && (
                    <span>· {Math.round(r.successRate * 100)}%</span>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
