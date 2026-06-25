import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { listRuns } from "@/lib/runs";
import type { Run } from "@/lib/types";

export const dynamic = "force-dynamic";

function when(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default async function RunsPage() {
  const runs = await listRuns();
  const review = runs.filter((r) => r.status === "needs_review");
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          ← mimic
        </Link>
        <Link href="/skills">
          <Button variant="ghost">Skills</Button>
        </Link>
      </header>

      {review.length > 0 && (
        <div className="border-t border-border pt-8">
          <div className="flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Needs review
            </h2>
            <Badge>{review.length} paused</Badge>
          </div>
          <p className="mt-1.5 text-sm text-ink-2">
            Runs Mimic paused because it wasn&apos;t confident. Open one to
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
              Autonomous executions, each with step-by-step proof.
            </p>
          </div>
          <Badge>{runs.length} runs</Badge>
        </div>

        <div className="mt-6 grid gap-3">
          {runs.length === 0 && (
            <Card className="p-8 text-center text-sm text-ink-2">
              No runs yet. Open a skill and hit Run.
            </Card>
          )}
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`}>
              <RunRow run={r} />
            </Link>
          ))}
        </div>
      </div>
      <div className="py-10" />
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  return (
    <Card className="flex items-center justify-between p-4 transition-colors hover:bg-surface-2">
      <div className="min-w-0">
        <div className="mono truncate text-sm">{run.id}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
          <span className="mono">{run.skillId}</span>
          <span>·</span>
          <span>{when(run.createdAt)}</span>
        </div>
      </div>
      <StatusBadge status={run.status} />
    </Card>
  );
}
