import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { RunPanel } from "@/components/RunPanel";
import { BulkRunPanel } from "@/components/BulkRunPanel";
import { Stars } from "@/components/Stars";
import { RatingWidget } from "@/components/RatingWidget";
import {
  getSkill,
  skillTargets,
  categorize,
  listPublishedSkills,
} from "@/lib/skills";
import { hasRunSkill } from "@/lib/runs";
import { getSession } from "@/lib/auth";
import { short, ago } from "@/lib/format";
import {
  getSkillReputation,
  getMyRating,
  listReviews,
} from "@/lib/reputation";

export const dynamic = "force-dynamic";


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
  const [rep, reviews, myRating, hasRun] = await Promise.all([
    getSkillReputation(skill.id),
    listReviews(skill.id),
    session ? getMyRating(skill.id, session.pubkey) : Promise.resolve(null),
    session && !isOwner
      ? hasRunSkill(session.pubkey, skill.id)
      : Promise.resolve(false),
  ]);
  const canRate = !!session && !isOwner && hasRun;

  // Related discovery: other published skills by this creator + same category.
  const category = categorize(skill.name, skill.description);
  const published = await listPublishedSkills(100);
  const fromCreator = published
    .filter((s) => s.owner === skill.owner && s.id !== skill.id)
    .slice(0, 4);
  const related = published
    .filter(
      (s) =>
        s.id !== skill.id &&
        s.owner !== skill.owner &&
        categorize(s.name, s.description) === category,
    )
    .slice(0, 4);

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
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide">
                {category}
              </span>
              <span className="mono">by {short(skill.owner)}</span>
              <span>·</span>
              <span>{skill.runCount} runs</span>
              <span>·</span>
              <span>{skill.plan.length} steps</span>
              <span>·</span>
              <span className="mono">v{skill.version}</span>
              <span>· updated {ago(skill.updatedAt)}</span>
              {rep.ratingCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-sm">
                    <Stars value={rep.avgStars} />
                  </span>
                  <span>
                    {rep.avgStars.toFixed(1)} ({rep.ratingCount})
                  </span>
                </>
              )}
              {rep.runs > 0 && (
                <>
                  <span>·</span>
                  <span>{Math.round(rep.successRate * 100)}% success</span>
                </>
              )}
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

        {/* Bulk run */}
        {skill.inputSchema.fields.length > 0 && (
          <div className="mt-4">
            <BulkRunPanel
              skillId={skill.id}
              fields={skill.inputSchema.fields}
              requireTrust={!isOwner}
            />
          </div>
        )}

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

        {/* Ratings & reviews */}
        <h2 className="mt-10 text-lg font-semibold tracking-tight">
          Ratings {rep.ratingCount > 0 && `(${rep.ratingCount})`}
        </h2>
        {!isOwner && session && (
          <div className="mt-4">
            {canRate ? (
              <RatingWidget
                skillId={skill.id}
                initialStars={myRating?.stars ?? 0}
                initialComment={myRating?.comment ?? ""}
              />
            ) : (
              <p className="text-sm text-ink-3">
                Run this skill once to rate it.
              </p>
            )}
          </div>
        )}
        {reviews.length > 0 && (
          <div className="mt-4 grid gap-2">
            {reviews.map((rv, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <Stars value={rv.stars} />
                  </span>
                  <span className="mono text-xs text-ink-3">
                    {short(rv.rater)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                  {rv.comment}
                </p>
              </Card>
            ))}
          </div>
        )}
        {reviews.length === 0 && rep.ratingCount === 0 && (
          <p className="mt-3 text-sm text-ink-3">No ratings yet.</p>
        )}

        {fromCreator.length > 0 && (
          <SkillStrip title={`More from ${short(skill.owner)}`} skills={fromCreator} />
        )}
        {related.length > 0 && (
          <SkillStrip title={`More in ${category}`} skills={related} />
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}

function SkillStrip({
  title,
  skills,
}: {
  title: string;
  skills: { id: string; name: string; description: string; runCount: number }[];
}) {
  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {skills.map((s) => (
          <Link key={s.id} href={`/market/${s.id}`}>
            <Card className="flex h-full flex-col p-4 transition-colors hover:bg-surface-2">
              <h3 className="text-sm font-medium tracking-tight">{s.name}</h3>
              <p className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-ink-3">
                {s.description}
              </p>
              <div className="mono mt-2 text-xs text-ink-3">{s.runCount} runs</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
