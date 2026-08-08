import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { WalletGate } from "@/components/WalletGate";
import { ScheduleControls } from "@/components/ScheduleControls";
import { getSession } from "@/lib/auth";
import { listSchedules, cadenceLabel } from "@/lib/schedules";
import { listSkills } from "@/lib/skills";
import { ruleSentence } from "@/lib/watches";
import { when } from "@/lib/format";

export const dynamic = "force-dynamic";


export default async function SchedulesPage() {
  const session = await getSession();
  const schedules = session ? await listSchedules(session.pubkey) : [];
  // What each watch's action actually RUNS.
  //
  // The list said "then runs a skill" and stopped there, and an action can only
  // be disarmed, never edited — so nothing in the product would tell you what
  // you had armed. Naming it is the difference between a line you can check and
  // one you have to take on trust.
  const names = new Map(
    (session && schedules.some((s) => s.watch?.actionSkillId)
      ? await listSkills(session.pubkey)
      : []
    ).map((s) => [s.id, s.name]),
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              Skills that run themselves on a cadence - no clicks. Results land
              in{" "}
              <Link href="/runs" className="text-ink underline">
                Runs
              </Link>
              .
            </p>
          </div>
          <Badge>{schedules.filter((s) => s.active).length} active</Badge>
        </div>

        <div className="mt-6">
          <WalletGate
            signedIn={!!session}
            hint="Connect your wallet to manage schedules."
          >
            <div className="grid gap-3">
              {schedules.length === 0 && (
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
                    {cadenceLabel(s.cadence)}
                  </span>
                  {!s.active && (
                    <span className="text-[0.65rem] uppercase tracking-wide text-ink-3">
                      paused
                    </span>
                  )}
                </div>
                {s.watch && (
                  // A schedule that is really a watch, and a watch that starts a
                  // skill when it fires, both looked exactly like a plain
                  // scheduled run here. Something that spends quota and acts on
                  // your behalf has to be legible from the page you manage it on.
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                      watch
                    </span>
                    <span>{ruleSentence(s.watch)}</span>
                    {s.watch.actionSkillId && (
                      <>
                        <span>·</span>
                        <span>
                          then runs{" "}
                          {names.has(s.watch.actionSkillId) ? (
                            <Link
                              href={`/skills/${s.watch.actionSkillId}`}
                              className="text-ink underline"
                            >
                              {names.get(s.watch.actionSkillId)}
                            </Link>
                          ) : (
                            // Shared with you and since unshared, or otherwise
                            // out of reach: say so rather than name nothing.
                            "a skill you can no longer open"
                          )}
                        </span>
                      </>
                    )}
                  </div>
                )}
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
              <ScheduleControls
                scheduleId={s.id}
                active={s.active}
                acts={!!s.watch?.actionSkillId}
              />
            </Card>
              ))}
            </div>
            {schedules.length > 0 && (
              <p className="mt-4 text-xs text-ink-3">
                Scheduled runs use your daily tier quota and pay skill creators
                like any other run.
              </p>
            )}
          </WalletGate>
        </div>
      </div>
      <div className="py-10" />
    </div>
  );
}
