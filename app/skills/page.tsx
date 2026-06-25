import Link from "next/link";
import { Badge, Button, Card, Label } from "@/components/ui";
import { listDemonstrations } from "@/lib/demonstrations";

export const dynamic = "force-dynamic";

function when(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default async function SkillsPage() {
  const demos = await listDemonstrations();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          ← mimic
        </Link>
        <Link href="/record">
          <Button variant="primary">Record a task</Button>
        </Link>
      </header>

      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
            <p className="mt-1.5 text-sm text-ink-2">
              Recorded demonstrations, ready to be generalized into reusable
              skills.
            </p>
          </div>
          <Badge>{demos.length} recorded</Badge>
        </div>

        <div className="mt-6 grid gap-3">
          {demos.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm text-ink-2">
                Nothing recorded yet.{" "}
                <Link href="/record" className="text-ink underline">
                  Record your first task
                </Link>
                .
              </p>
            </Card>
          )}
          {demos.map((d) => (
            <Card
              key={d.id}
              className="flex items-center justify-between p-4"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{d.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                  <span className="mono">{d.id}</span>
                  <span>·</span>
                  <span>{d.trace.length} steps</span>
                  <span>·</span>
                  <span>{when(d.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {d.startUrl && (
                  <span className="hidden max-w-[220px] truncate text-xs text-ink-3 md:inline">
                    {d.startUrl}
                  </span>
                )}
                <Label>Phase 2 →</Label>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="py-10" />
    </div>
  );
}
