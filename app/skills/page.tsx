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
  const owner = (await getSession())?.pubkey ?? "";
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
                No skills yet. Generalize a recording below to create one.
              </p>
            </Card>
          )}
          {skills.map((s) => (
            <Link key={s.id} href={`/skills/${s.id}`}>
              <Card className="flex items-center justify-between p-4 transition-colors hover:bg-surface-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="mt-1 truncate text-sm text-ink-2">
                    {s.description}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-3">
                    <span className="mono">{s.id}</span>
                    <span>·</span>
                    <span>{s.plan.length} steps</span>
                    <span>·</span>
                    <span>{s.inputSchema.fields.length} inputs</span>
                    <span>·</span>
                    <span>{when(s.updatedAt)}</span>
                  </div>
                </div>
                <Label>Review →</Label>
              </Card>
            </Link>
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
          Raw demonstrations, ready to turn into skills. Record the same task two
          or more times, select them, and synthesize a skill that learns what
          varies.
        </p>

        <SynthesizePanel
          demos={pending.map((d) => ({
            id: d.id,
            title: d.title,
            steps: d.trace.length,
            createdAt: d.createdAt,
          }))}
        />
      </div>

      <div className="py-10" />
    </div>
  );
}
