import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill, listSkillVersions, listSkills, skillAccess, templateTool } from "@/lib/skills";
import { planHasChaining } from "@/lib/chain";
import { listTriggers } from "@/lib/triggers";
import { listMyOrgs } from "@/lib/orgs";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [skill, session] = await Promise.all([getSkill(id), getSession()]);
  if (!skill || !session) notFound();
  // Editor is for editors: the creator, or an admin of the org it's shared with.
  if (!(await skillAccess(skill, session.pubkey)).edit) notFound();
  const [versions, triggers, mine, myOrgs] = await Promise.all([
    listSkillVersions(id),
    listTriggers(session.pubkey, id),
    listSkills(session.pubkey),
    listMyOrgs(session.pubkey),
  ]);
  // Other skills this owner can chain to (exclude self).
  const others = mine.filter((s) => s.id !== id);
  const otherSkills = others.map((s) => ({ id: s.id, name: s.name }));
  // What a watch may actually TRIGGER, which is narrower.
  //
  // Chaining refuses a marketplace TEMPLATE (placeholder steps, nothing to
  // replay) and a skill that itself chains (one level, so there is no recursion
  // to bound). Offered anyway, one could be picked, saved without complaint,
  // and then refused on every single fire — a watch that looked armed and could
  // never do the thing it was made for. Kept as a separate list from the one
  // above on purpose: the chain-step editor shows an ALREADY SAVED target by
  // id, so filtering that list would draw an existing step as unset.
  const triggerableSkills = others
    .filter((s) => !templateTool(s) && !planHasChaining(s.plan))
    .map((s) => ({ id: s.id, name: s.name }));
  // Where this one started, when it started as someone else's. Named only if it
  // is still published — a private skill's title is not a stranger's to learn.
  const parentRaw = skill.forkedFrom ? await getSkill(skill.forkedFrom) : null;
  const forkedFrom =
    parentRaw && (parentRaw.published || parentRaw.owner === session.pubkey)
      ? { id: parentRaw.id, name: parentRaw.name, published: parentRaw.published }
      : null;

  return (
    <SkillEditor
      initial={skill}
      versions={versions}
      triggers={triggers}
      otherSkills={otherSkills}
      triggerableSkills={triggerableSkills}
      forkedFrom={forkedFrom}
      myOrgs={myOrgs}
      isOwner={skill.owner === session.pubkey}
    />
  );
}
