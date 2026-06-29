import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill, listSkillVersions } from "@/lib/skills";
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
  const [versions, triggers] = await Promise.all([
    listSkillVersions(id),
    listTriggers(session.pubkey, id),
  ]);
  return <SkillEditor initial={skill} versions={versions} triggers={triggers} />;
}
