import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { RunPanel } from "@/components/RunPanel";
import { getSkill, skillTargets } from "@/lib/skills";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function short(pk: string): string {
  return pk ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : "anon";
}

export default async function MarketSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [skill, session] = await Promise.all([getSkill(id), getSession()]);
  if (!skill || !skill.published) notFound();
  // Owners running their own skill don't need the trust ack.
  const isOwner = session?.pubkey === skill.owner;
  const domains = skillTargets(skill.plan);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <Link href="/market" className="text-sm text-ink-3 hover:text-ink">
          ← marketplace
        </Link>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {skill.name}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
              {skill.description}
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-3">
              <span className="mono">by {short(skill.owner)}</span>
              <span>·</span>
              <span>{skill.runCount} runs</span>
              <span>·</span>
              <span>{skill.plan.length} steps</span>
            </div>
          </div>
          <Badge>Published</Badge>
        </div>

        {/* Run it */}
        <div className="mt-6">
          <RunPanel
            skillId={skill.id}
            fields={skill.inputSchema.fields}
            domains={domains}
            requireTrust={!isOwner}
          />
        </div>

        {/* What it does (read-only) */}
        <h2 className="mt-10 text-lg font-semibold tracking-tight">
          What it does
        </h2>
        <div className="mt-4 grid gap-2">
          {skill.plan.map((s) => (
            <Card key={s.idx} className="flex items-center gap-3 p-3.5">
              <span className="mono w-8 shrink-0 text-ink-3">
                {String(s.idx).padStart(2, "0")}
              </span>
              <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
                {s.action}
              </span>
              <span className="flex-1 truncate text-sm text-ink-2">
                {s.intent}
              </span>
            </Card>
          ))}
        </div>

        {skill.inputSchema.fields.length > 0 && (
          <>
            <h2 className="mt-8 text-lg font-semibold tracking-tight">Inputs</h2>
            <Card className="mt-3 p-4">
              <Label>Fields it needs each run</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {skill.inputSchema.fields.map((f) => (
                  <span
                    key={f.key}
                    className="rounded-full border border-border-strong bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
                  >
                    {f.label || f.key}
                  </span>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}
