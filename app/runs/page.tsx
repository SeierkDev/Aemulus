import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { AccountBar } from "@/components/AccountBar";
import { RecentActivity } from "@/components/RecentActivity";
import { StatusBadge } from "@/components/StatusBadge";
import { listRuns, listRecentPlatformRuns } from "@/lib/runs";
import { getSession } from "@/lib/auth";
import type { Run } from "@/lib/types";
import { when } from "@/lib/format";

export const dynamic = "force-dynamic";


export default async function RunsPage() {
  const session = await getSession();
  const owner = session?.pubkey ?? "";
  const [runs, recent] = await Promise.all([
    listRuns(owner),
    listRecentPlatformRuns(8),
  ]);
  const review = runs.filter((r) => r.status === "needs_review");
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />

      {review.length > 0 && (
        <div className="border-t border-border pt-8">
          <div className="flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Needs review
            </h2>
            <Badge>{review.length} paused</Badge>
          </div>
          <p className="mt-1.5 text-sm text-ink-2">
            Runs Aemulus paused because it wasn&apos;t confident. Open one to
            resolve and retry.
          </p>
          <div className="mt-4 grid gap-3">
            {review.map((r) => (
              <Link key={r.id} href={`/runs/${r.id}`}>
                <RunRow run={r} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {review.length > 0 ? "All runs" : "Runs"}
            </h1>
            <p className="mt-1.5 text-sm text-ink-2">
              Autonomous executions, each with step-by-step proof.{" "}
              <Link href="/schedules" className="text-ink underline">
                Schedules →
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge>{runs.length} runs</Badge>
            <AccountBar />
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {runs.length === 0 && (
            <Card className="p-8 text-center text-sm text-ink-2">
              {!session
                ? "Connect your wallet to see your runs."
                : "No runs yet. Open a skill from the marketplace and hit Run."}
            </Card>
          )}
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`}>
              <RunRow run={r} />
            </Link>
          ))}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-12 border-t border-border pt-8">
          <RecentActivity runs={recent} title="Recent on the marketplace" />
        </div>
      )}
      <div className="py-10" />
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  return (
    <Card className="flex items-center justify-between p-4 transition-colors hover:bg-surface-2">
      <div className="min-w-0">
        <div className="mono truncate text-sm">{run.id}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          <span className="mono">{run.skillId}</span>
          <span>·</span>
          <span>{when(run.createdAt)}</span>
        </div>
      </div>
      <StatusBadge status={run.status} />
    </Card>
  );
}
