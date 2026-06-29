import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill, listSkillVersions, listSkills } from "@/lib/skills";
import { listTriggers } from "@/lib/triggers";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [skill, session] = await Promise.all([getSkill(id), getSession()]);
  if (!skill || skill.owner !== session?.pubkey) notFound();
  const [versions, triggers, mine] = await Promise.all([
    listSkillVersions(id),
    listTriggers(session.pubkey, id),
    listSkills(session.pubkey),
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
    />
  );
}
