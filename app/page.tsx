import Link from "next/link";
import { Badge, Button } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { Dashboard } from "@/components/home/Dashboard";
import { PopularSkills } from "@/components/home/PopularSkills";
import { Marketing } from "@/components/home/Marketing";
import { Showcase } from "@/components/home/Showcase";
import { CodeBackdrop } from "@/components/CodeBackdrop";
import { Reveal } from "@/components/Reveal";
import { listSkills, listPublishedSkills } from "@/lib/skills";
import { listRuns, countPlatformRunsLast24h } from "@/lib/runs";
import { getReputationBatch } from "@/lib/reputation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const [skills, runs, popular, platformRuns24h] = await Promise.all([
    session ? listSkills(session.pubkey) : Promise.resolve([]),
    session ? listRuns(session.pubkey) : Promise.resolve([]),
    listPublishedSkills(6),
    countPlatformRunsLast24h(),
  ]);
  const hasData = skills.length > 0 || runs.length > 0;
  const popularRep = await getReputationBatch(popular.map((s) => s.id));

  return (
    <>
      <CodeBackdrop />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
        <Nav />

      {/* Hero */}
      <section className="flex flex-col items-center gap-7 border-t border-border pt-32 pb-28 text-center">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Show it once. It does the rest.
        </Badge>
        <h1 className="mx-auto max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
          Automate any browser task by{" "}
          <span className="text-ink-2">demonstrating</span> it, not coding it.
        </h1>
        <p className="mx-auto max-w-2xl text-xl leading-relaxed text-ink-2">
          Aemulus watches you do a repetitive task once, learns the intent, and
          runs it autonomously, stopping to ask only when it hits something
          genuinely new.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link href="/record">
            <Button variant="primary">
              {hasData ? "Record another task" : "Record your first task"}
            </Button>
          </Link>
          <Link href="/market">
            <Button variant="default">Explore skills</Button>
          </Link>
        </div>
      </section>

        {hasData && (
          <Dashboard skills={skills} runs={runs} platformRuns24h={platformRuns24h} />
        )}
        <Reveal>
          <Showcase />
        </Reveal>
        <Reveal>
          <PopularSkills skills={popular} rep={popularRep} />
        </Reveal>
        <Marketing />
      </div>
    </>
  );
}
