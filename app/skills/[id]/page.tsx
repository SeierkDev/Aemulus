import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/SkillEditor";
import { getSkill } from "@/lib/skills";

export const dynamic = "force-dynamic";

export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = await getSkill(id);
  if (!skill) notFound();
  return <SkillEditor initial={skill} />;
}
