import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { ScheduleControls } from "@/components/ScheduleControls";
import { getSession } from "@/lib/auth";
import { listSchedules } from "@/lib/schedules";

export const dynamic = "force-dynamic";

function when(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default async function SchedulesPage() {
  const session = await getSession();
  const schedules = session ? await listSchedules(session.pubkey) : [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              Skills that run themselves on a cadence — no clicks. Results land
              in{" "}
              <Link href="/runs" className="text-ink underline">
                Runs
              </Link>
              .
            </p>
          </div>
          <Badge>{schedules.filter((s) => s.active).length} active</Badge>
        </div>

        <div className="mt-6 grid gap-3">
          {!session && (
            <Card className="p-8 text-center text-sm text-ink-2">
              Connect your wallet to manage schedules.
            </Card>
          )}
          {session && schedules.length === 0 && (
            <Card className="p-8 text-center text-sm text-ink-2">
              No schedules yet. Open a skill and choose “Automate on schedule”.
            </Card>
          )}
          {schedules.map((s) => (
            <Card key={s.id} className="flex items-center justify-between p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/skills/${s.skillId}`}
                    className="truncate font-medium hover:underline"
                  >
                    {s.skillName}
                  </Link>
                  <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
                    {s.cadence}
                  </span>
                  {!s.active && (
                    <span className="text-[0.65rem] uppercase tracking-wide text-ink-3">
                      paused
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span>next {when(s.nextRunAt)}</span>
                  <span>·</span>
                  <span>last {when(s.lastRunAt)}</span>
                  {s.lastRunId && (
                    <>
                      <span>·</span>
                      <Link
                        href={`/runs/${s.lastRunId}`}
                        className="hover:text-ink"
                      >
                        view last run →
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <ScheduleControls scheduleId={s.id} active={s.active} />
            </Card>
          ))}
        </div>
        {session && schedules.length > 0 && (
          <p className="mt-4 text-xs text-ink-3">
            Scheduled runs use your daily tier quota and pay skill creators like
            any other run.
          </p>
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}
