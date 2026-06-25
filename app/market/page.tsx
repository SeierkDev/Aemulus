import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { listPublishedSkills } from "@/lib/skills";

export const dynamic = "force-dynamic";

function short(pk: string): string {
  return pk ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : "anon";
}

export default async function MarketPage() {
  const skills = await listPublishedSkills();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Skill marketplace
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              Skills published by the community. Run any of them on your own
              inputs — no recording required.
            </p>
          </div>
          <Badge>{skills.length} published</Badge>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {skills.length === 0 && (
            <Card className="p-8 text-center text-sm text-ink-2 md:col-span-2">
              Nothing published yet. Generalize a skill and hit Publish to be
              first.
            </Card>
          )}
          {skills.map((s) => (
            <Link key={s.id} href={`/market/${s.id}`}>
              <Card className="flex h-full flex-col p-5 transition-colors hover:bg-surface-2">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium tracking-tight">{s.name}</h3>
                  <span className="mono shrink-0 text-xs text-ink-3">
                    {s.runCount} runs
                  </span>
                </div>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-2">
                  {s.description}
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                  <span className="mono">by {short(s.owner)}</span>
                  <span>·</span>
                  <span>{s.plan.length} steps</span>
                  <span>·</span>
                  <span>{s.inputSchema.fields.length} inputs</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
      <div className="py-10" />
    </div>
  );
}
