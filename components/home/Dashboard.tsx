import Link from "next/link";
import { Card, Label } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { when } from "@/lib/format";
import type { Run, Skill } from "@/lib/types";

/** Returning-user dashboard: review nudge, stats, and recent runs. */
export function Dashboard({
  skills,
  runs,
  platformRuns24h,
}: {
  skills: Skill[];
  runs: Run[];
  platformRuns24h: number;
}) {
  const needsReview = runs.filter((r) => r.status === "needs_review");
  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const recentRuns = runs.slice(0, 5);

  return (
    <section className="mt-14">
      {needsReview.length > 0 && (
        <Link href="/runs">
          <Card className="mb-4 flex items-center justify-between border-border-strong p-4 transition-colors hover:bg-surface-2">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-ink" />
              <span className="text-sm">
                <span className="font-medium">
                  {needsReview.length} run{needsReview.length > 1 ? "s" : ""}
                </span>{" "}
                <span className="text-ink-2">need your input to continue.</span>
              </span>
            </div>
            <span className="text-sm text-ink-3">Review →</span>
          </Card>
        </Link>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Your skills" value={skills.length} href="/skills" />
        <Stat label="Runs · 24h" value={platformRuns24h} href="/market" />
        <Stat label="Needs review" value={needsReview.length} href="/runs" />
      </div>

      {recentRuns.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <Label>Recent runs</Label>
            <Link href="/runs" className="text-xs text-ink-3 hover:text-ink">
              All runs →
            </Link>
          </div>
          <div className="mt-3 grid gap-2">
            {recentRuns.map((r) => (
              <Link key={r.id} href={`/runs/${r.id}`}>
                <Card className="flex items-center justify-between p-3.5 transition-colors hover:bg-surface-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      {skillName.get(r.skillId) ?? r.skillId}
                    </div>
                    <div className="mono mt-0.5 truncate text-xs text-ink-3">
                      {r.id} · {when(r.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="p-5 transition-colors hover:bg-surface-2">
        <div className="mono text-3xl font-semibold tracking-tight">{value}</div>
        <div className="mono mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
          {label}
        </div>
      </Card>
    </Link>
  );
}
