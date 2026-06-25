import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill } from "@/lib/skills";
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
  return <SkillEditor initial={skill} />;
}
