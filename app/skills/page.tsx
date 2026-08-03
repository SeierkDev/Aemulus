import Link from "next/link";
import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { AccountBar } from "@/components/AccountBar";
import { SynthesizePanel } from "@/components/SynthesizePanel";
import { listDemonstrations } from "@/lib/demonstrations";
import { listSkills } from "@/lib/skills";
import { getSession } from "@/lib/auth";
import { when } from "@/lib/format";

export const dynamic = "force-dynamic";


export default async function SkillsPage() {
  const session = await getSession();
  const owner = session?.pubkey ?? "";
  const [skills, demos] = await Promise.all([
    listSkills(owner),
    listDemonstrations(owner),
  ]);
  const generalizedDemoIds = new Set(
    skills.map((s) => s.sourceDemoId).filter(Boolean),
  );
  const pending = demos.filter((d) => !generalizedDemoIds.has(d.id));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />

      {/* Skills */}
      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
            <p className="mt-1.5 text-sm text-ink-2">
              Generalized procedures Aemulus can run on new inputs.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge>{skills.length} skills</Badge>
            <AccountBar />
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {skills.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm text-ink-2">
                {!session
                  ? "Connect your wallet to see the skills you've created."
                  : "You haven't created any skills yet. Generalize a recording below to create one."}
              </p>
            </Card>
          )}
          {skills.map((s) => (
            // The card is no longer one big link: analytics needs its own
            // destination, and an anchor inside an anchor is invalid markup that
            // browsers silently rewrite.
            <Card
              key={s.id}
              className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-2"
            >
              <Link href={`/skills/${s.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.name}</div>
                <div className="mt-1 truncate text-sm text-ink-2">
                  {s.description}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                  <span className="mono">{s.id}</span>
                  <span>·</span>
                  <span>{s.plan.length} steps</span>
                  <span>·</span>
                  <span>{s.inputSchema.fields.length} inputs</span>
                  <span>·</span>
                  <span>{when(s.updatedAt)}</span>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-4">
                <Link
                  href={`/skills/${s.id}/analytics`}
                  className="text-sm text-ink-3 underline underline-offset-4 hover:text-ink"
                >
                  Analytics
                </Link>
                <Link href={`/skills/${s.id}`}>
                  <Label>Review →</Label>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Recordings awaiting generalization */}
      <div className="mt-12 border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recordings</h2>
          <Badge>{pending.length} to generalize</Badge>
        </div>
        <p className="mt-1.5 text-sm text-ink-2">
          Your raw demonstrations, ready to turn into skills. Record the same
          task two or more times, select them, and synthesize a skill that
          learns what varies.
        </p>

        {!session ? (
          <Card className="mt-6 p-8 text-center text-sm text-ink-2">
            Connect your wallet to see your recordings.
          </Card>
        ) : (
          <SynthesizePanel
            demos={pending.map((d) => ({
              id: d.id,
              title: d.title,
              steps: d.trace.length,
              createdAt: d.createdAt,
            }))}
          />
        )}
      </div>

      <div className="py-10" />
    </div>
  );
}
