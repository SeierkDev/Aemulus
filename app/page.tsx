import Link from "next/link";
import { Badge, Button } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { Dashboard } from "@/components/home/Dashboard";
import { PopularSkills } from "@/components/home/PopularSkills";
import { Marketing } from "@/components/home/Marketing";
import { listSkills, listPublishedSkills } from "@/lib/skills";
import { listRuns } from "@/lib/runs";
import { getReputationBatch } from "@/lib/reputation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const [skills, runs, popular] = await Promise.all([
    session ? listSkills(session.pubkey) : Promise.resolve([]),
    session ? listRuns(session.pubkey) : Promise.resolve([]),
    listPublishedSkills(6),
  ]);
  const hasData = skills.length > 0 || runs.length > 0;
  const popularRep = await getReputationBatch(popular.map((s) => s.id));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />

      {/* Hero */}
      <section className="flex flex-col items-start gap-5 border-t border-border pt-14">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Show it once. It does the rest.
        </Badge>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Automate any browser task by{" "}
          <span className="text-ink-2">demonstrating</span> it — not coding it.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
          Aemulus watches you do a repetitive task one time, learns the intent,
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

      {hasData && <Dashboard skills={skills} runs={runs} />}
      <PopularSkills skills={popular} rep={popularRep} />
      <Marketing />
    </div>
  );
}
