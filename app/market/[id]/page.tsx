import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { RunPanel } from "@/components/RunPanel";
import { BulkRunPanel } from "@/components/BulkRunPanel";
import { Stars } from "@/components/Stars";
import { ForkButton } from "@/components/ForkButton";
import { branchSpan, conditionSentence } from "@/lib/watches";
import { RatingWidget } from "@/components/RatingWidget";
import { ReportButton } from "@/components/ReportButton";
import {
  forkCount,
  getSkill,
  skillTargets,
  categorize,
  listPublishedSkillsLite,
  templateTool,
} from "@/lib/skills";
import { hasRunSkill } from "@/lib/runs";
import { getSession } from "@/lib/auth";
import { SOLANA } from "@/lib/solana";
import { isVerified } from "@/lib/moderation";
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
  // A marketplace template (placeholder steps for a tool) isn't runnable - it's
  // a starter you record your own version of. Show a record CTA, not a run panel.
  // Recording a logged-in tool must happen in the EXTENSION (own signed-in
  // browser), not the cloud recorder - so the CTA points at the extension.
  const tmpl = templateTool(skill);
  const extStoreUrl = process.env.AEMULUS_EXTENSION_URL;
  // Owners running their own skill don't need the trust ack.
  const isOwner = session?.pubkey === skill.owner;
  const domains = skillTargets(skill.plan);
  // All independent of each other - fetch in one batch (incl. related skills,
  // which only needs `skill`, already resolved).
  const [rep, reviews, myRating, hasRun, published] = await Promise.all([
    getSkillReputation(skill.id),
    listReviews(skill.id),
    session ? getMyRating(skill.id, session.pubkey) : Promise.resolve(null),
    session && !isOwner
      ? hasRunSkill(session.pubkey, skill.id)
      : Promise.resolve(false),
    listPublishedSkillsLite(100),
  ]);
  const canRate = !!session && !isOwner && hasRun;

  // Related discovery: other published skills by this creator + same category.
  const category = categorize(skill.name, skill.description);
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

  // Which steps only happen if a branch above them holds. Listing a plan flat
  // says nine steps all happen; when four are behind a branch, that is not a
  // description of the skill but an overstatement of it — on the page whose
  // heading is what it does.
  // Provenance and what it spawned. The parent is only named when it is still
  // published: a private skill's existence and title are not a stranger's to
  // learn from a page about someone else's fork.
  const [forks, parentRaw] = await Promise.all([
    forkCount(skill.id),
    skill.forkedFrom ? getSkill(skill.forkedFrom) : Promise.resolve(null),
  ]);
  const parent = parentRaw && parentRaw.published ? parentRaw : null;

  const branchCover: boolean[] = [];
  {
    let through = -1;
    skill.plan.forEach((s, pos) => {
      const covered = pos <= through;
      branchCover.push(covered);
      if (!covered && s.condition) through = pos + branchSpan(s.condition) - 1;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="mx-auto w-full max-w-4xl border-t border-border pt-8">
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
              {!tmpl && (
                <>
                  <span>·</span>
                  <span>{skill.runCount} runs</span>
                </>
              )}
              <span>·</span>
              <span>{skill.plan.length} steps</span>
              {forks > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {forks} {forks === 1 ? "fork" : "forks"}
                  </span>
                </>
              )}
              {/* Where it started. Only when the original is still published:
                  naming a private skill to a stranger would leak both that it
                  exists and what it is called. */}
              {parent && (
                <>
                  <span>·</span>
                  <span>
                    forked from{" "}
                    <Link href={`/market/${parent.id}`} className="text-ink underline">
                      {parent.name}
                    </Link>
                  </span>
                </>
              )}
              <span>·</span>
              <span className="mono">v{skill.version}</span>
              <span>· updated {ago(skill.updatedAt)}</span>
              {!tmpl && rep.ratingCount > 0 && (
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
              {!tmpl && rep.runs > 0 && (
                <>
                  <span>·</span>
                  <span>{Math.round(rep.successRate * 100)}% success</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isVerified(skill.owner) && <Badge>✓ Verified</Badge>}
            <Badge>{tmpl ? "Template" : "Published"}</Badge>
            {/* Not on your own skill (forking it would make a second copy of
                something you can already edit), and not on a template, whose
                steps are placeholders — a copy of those can never run, and this
                page already tells you to record your own instead. */}
            {!tmpl && skill.owner !== session?.pubkey && (
              <ForkButton skillId={skill.id} signedIn={!!session} />
            )}
          </div>
        </div>

        {tmpl ? (
          /* Template: not runnable as-is. Recording a logged-in tool has to happen
             in the extension (your own signed-in browser), never the cloud recorder. */
          <Card className="mt-6 flex flex-col gap-5 p-6">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                This is a starter template for {tmpl}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
                It shows the shape of the task, but the steps are just
                illustrative. Real tools change their pages, so a template
                can&apos;t run as-is. To make it yours, record the task once on
                your own {tmpl} with the Aemulus browser extension, so it records
                right in your own signed-in browser. The cloud recorder can&apos;t
                log into your tools; the extension already is you.
              </p>
            </div>
            <ol className="grid gap-2 text-sm text-ink-2">
              <li>
                <span className="mono text-ink-3">1.</span> Install the browser
                extension.
              </li>
              <li>
                <span className="mono text-ink-3">2.</span> Open {tmpl} and sign in
                as usual.
              </li>
              <li>
                <span className="mono text-ink-3">3.</span> Click the Aemulus
                extension, hit Record, do the task once, then Stop. It becomes a
                skill you can run and publish.
              </li>
            </ol>
            <div>
              {extStoreUrl ? (
                <a
                  href={extStoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex rounded-[var(--radius-base)] bg-ink px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
                >
                  Get the extension
                </a>
              ) : (
                <span className="inline-flex rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-5 py-2.5 text-sm text-ink-3">
                  Extension coming to the Chrome Web Store
                </span>
              )}
            </div>
          </Card>
        ) : (
          <>
            {/* Run it */}
            <div className="mt-6">
              {!isOwner && (
                <p className="mb-2 text-xs text-ink-3">
                  Each run credits the creator {SOLANA.runFee} $AEMU. AI cost
                  applies only if a step needs the operator.
                </p>
              )}
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
          </>
        )}

        {/* What it does (read-only) */}
        <h2 className="mt-10 text-lg font-semibold tracking-tight">
          What it does
        </h2>
        <div className="mt-4 grid gap-2">
          {skill.plan.map((s, pos) => {
            const covered = branchCover[pos];
            const span = branchSpan(s.condition);
            return (
              <Card
                key={s.idx}
                className={`flex items-center gap-3 p-3.5${covered ? " ml-6 border-l-2 border-l-border-strong" : ""}`}
              >
                <span className="mono w-8 shrink-0 text-ink-3">
                  {String(s.idx).padStart(2, "0")}
                </span>
                <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
                  {s.action}
                </span>
                <span className="flex-1 truncate text-sm text-ink-2">
                  {s.intent}
                </span>
                {/* Shown even when this step is itself inside a branch: a
                    nested condition is part of what the skill does, and marking
                    it only as "in the branch above" hides the inner test
                    entirely — on the page whose heading is what it does. */}
                {s.condition && (
                  <span className="shrink-0 truncate text-xs text-ink-3" title={conditionSentence(s.condition)}>
                    {conditionSentence(s.condition)}
                    {span > 1 ? ` · covers ${span} steps` : ""}
                  </span>
                )}
                {covered && (
                  <span className="shrink-0 text-xs text-ink-3">in the branch above</span>
                )}
              </Card>
            );
          })}
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

        {session && !isOwner && (
          <div className="mt-8 flex items-center gap-2 border-t border-border pt-4 text-xs text-ink-3">
            <span>Something wrong with this skill?</span>
            <ReportButton skillId={skill.id} />
          </div>
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
