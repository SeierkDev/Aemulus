import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill, listSkillVersions, listSkills, skillAccess } from "@/lib/skills";
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
  const otherSkills = mine
    .filter((s) => s.id !== id)
    .map((s) => ({ id: s.id, name: s.name }));
  return (
    <SkillEditor
      initial={skill}
      versions={versions}
      triggers={triggers}
      otherSkills={otherSkills}
      myOrgs={myOrgs}
      isOwner={skill.owner === session.pubkey}
    />
  );
}
