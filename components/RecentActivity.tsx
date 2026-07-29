import Link from "next/link";
import { Card, Label } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { timeAgo } from "@/lib/format";
import type { RecentPlatformRun } from "@/lib/runs";

/** Public marketplace activity feed: recent runs across the platform, linking to
 * the skill (the run itself is private to whoever ran it). */
export function RecentActivity({
  runs,
  title = "Recent runs",
}: {
  runs: RecentPlatformRun[];
  title?: string;
}) {
  if (runs.length === 0) return null;
  return (
    <div>
      <Label>{title}</Label>
      <div className="mt-3 grid gap-2">
        {runs.map((r) => (
          <Link key={r.id} href={`/market/${r.skillId}`}>
            <Card className="flex items-center justify-between p-3.5 transition-colors hover:bg-surface-2">
              <div className="min-w-0">
                <div className="truncate text-sm">{r.skillName}</div>
                <div className="mono mt-0.5 text-xs text-ink-3">
                  {timeAgo(r.createdAt)}
                </div>
              </div>
              <StatusBadge status={r.status} />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
