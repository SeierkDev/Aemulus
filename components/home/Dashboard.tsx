import Link from "next/link";
import { Card } from "@/components/ui";
import { RecentActivity } from "@/components/RecentActivity";
import type { RecentPlatformRun } from "@/lib/runs";

/** Platform activity panel on the home page: live marketplace stats + a recent
 * runs feed. Platform-wide (not per-wallet) so it's always present and always
 * current, whether or not you're signed in. */
export function Dashboard({
  totalSkills,
  runs24h,
  needsReview,
  recentRuns,
}: {
  totalSkills: number;
  runs24h: number;
  needsReview: number;
  recentRuns: RecentPlatformRun[];
}) {
  return (
    <section className="mt-14">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Skills" value={totalSkills} href="/market" />
        <Stat label="Runs · 24h" value={runs24h} href="/market" />
        <Stat label="Needs review" value={needsReview} href="/runs" />
      </div>

      {recentRuns.length > 0 && (
        <div className="mt-8">
          <RecentActivity runs={recentRuns} />
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
        <div className="mono text-3xl font-semibold tracking-tight">
          {value.toLocaleString()}
        </div>
        <div className="mono mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
          {label}
        </div>
      </Card>
    </Link>
  );
}
