import Link from "next/link";
import { Badge, Button, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { StatusBadge } from "@/components/StatusBadge";
import { listSkills } from "@/lib/skills";
import { listRuns } from "@/lib/runs";

export const dynamic = "force-dynamic";

const STAGES = [
  ["Record", "Do the task once in a controlled browser — Mimic captures every action with a screenshot."],
  ["Generalize", "Claude turns that one demonstration into a reusable skill: the intent, and the fields that vary."],
  ["Run", "Point the skill at new inputs and it executes on its own — flagging only what it isn't sure about."],
];

function when(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default async function Home() {
  const [skills, runs] = await Promise.all([listSkills(), listRuns()]);
  const hasData = skills.length > 0 || runs.length > 0;
  const needsReview = runs.filter((r) => r.status === "needs_review");
  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const recentRuns = runs.slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />

      {/* Hero */}
      <section className="flex flex-col items-start gap-5 border-t border-border pt-14">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Show it once. It does the rest.
        </Badge>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight">
          Automate any browser task by{" "}
          <span className="text-ink-2">demonstrating</span> it — not coding it.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
          Mimic watches you do a repetitive task one time, learns the intent,
          and runs it autonomously — stopping to ask only when it hits something
          genuinely new.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <Link href="/record">
            <Button variant="primary">
              {hasData ? "Record another task" : "Record your first task"}
            </Button>
          </Link>
          {hasData && (
            <Link href="/skills">
              <Button variant="default">View skills</Button>
            </Link>
          )}
        </div>
      </section>

      {/* Dashboard (returning users) */}
      {hasData && (
        <section className="mt-14">
          {needsReview.length > 0 && (
            <Link href="/runs">
              <Card className="mb-4 flex items-center justify-between border-border-strong p-4 transition-colors hover:bg-surface-2">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-ink" />
                  <span className="text-sm">
                    <span className="font-medium">
                      {needsReview.length} run
                      {needsReview.length > 1 ? "s" : ""}
                    </span>{" "}
                    <span className="text-ink-2">
                      need your input to continue.
                    </span>
                  </span>
                </div>
                <span className="text-sm text-ink-3">Review →</span>
              </Card>
            </Link>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Skills" value={skills.length} href="/skills" />
            <Stat label="Runs" value={runs.length} href="/runs" />
            <Stat
              label="Needs review"
              value={needsReview.length}
              href="/runs"
            />
          </div>

          {recentRuns.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between">
                <Label>Recent runs</Label>
                <Link
                  href="/runs"
                  className="text-xs text-ink-3 hover:text-ink"
                >
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
      )}

      {/* How it works (always — onboarding for newcomers, reference for all) */}
      <section className="grid gap-4 py-16 md:grid-cols-3">
        {STAGES.map(([title, body], i) => (
          <Card key={title} className="p-5">
            <Label>Stage 0{i + 1}</Label>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              {title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
          </Card>
        ))}
      </section>

      <footer className="mt-auto flex items-center justify-between border-t border-border py-6 text-sm text-ink-3">
        <span className="mono">mimic</span>
        <span>show once · run forever</span>
      </footer>
    </div>
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
          {value}
        </div>
        <div className="mono mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
          {label}
        </div>
      </Card>
    </Link>
  );
}
