import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { SkillAnalyticsPanel } from "@/components/SkillAnalytics";
import { getSession } from "@/lib/auth";
import { getSkill, skillAccess } from "@/lib/skills";
import { getSkillAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * One skill's numbers, for the person who published it.
 *
 * Gated the same way the editor is: these are aggregates over other people's
 * runs, so only someone who may edit the skill may see how it performs.
 *
 * All three windows are computed here, in parallel, and handed to the client at
 * once. Switching window is then instant. Fetching per window meant a server
 * round trip and a fresh set of queries every time somebody pressed 7d.
 */
export default async function SkillAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [skill, session] = await Promise.all([getSkill(id), getSession()]);
  if (!skill || !session) notFound();
  if (!(await skillAccess(skill, session.pubkey)).edit) notFound();

  const [w7, w30, w90] = await Promise.all([
    getSkillAnalytics(id, 7),
    getSkillAnalytics(id, 30),
    getSkillAnalytics(id, 90),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
          How this skill behaves when other people run it. Counts only, never who
          ran what.
        </p>

        <div className="mt-6">
          <SkillAnalyticsPanel
            windows={{ 7: w7, 30: w30, 90: w90 }}
            skillName={skill.name}
            skillId={id}
          />
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
