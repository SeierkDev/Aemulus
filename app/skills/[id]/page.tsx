import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill, listSkillVersions } from "@/lib/skills";
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
  const versions = await listSkillVersions(id);
  return <SkillEditor initial={skill} versions={versions} />;
}
