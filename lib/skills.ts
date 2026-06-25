import { db, ready } from "./db";
import { id } from "./ids";
import type { GeneralizedSkill, Skill, SkillStep } from "./types";

/** Persist a freshly generalized skill owned by a wallet. */
export async function createSkill(input: {
  owner: string;
  generalized: GeneralizedSkill;
  sourceDemoId: string | null;
}): Promise<Skill> {
  await ready();
  const now = Date.now();
  const plan: SkillStep[] = input.generalized.steps.map((s, idx) => ({
    ...s,
    idx,
  }));
  const skill: Skill = {
    id: id("skl"),
    owner: input.owner,
    name: input.generalized.name,
    description: input.generalized.description,
    plan,
    inputSchema: { fields: input.generalized.inputFields },
    sourceDemoId: input.sourceDemoId,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO skills (id, owner, name, description, plan, input_schema, source_demo_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      skill.id,
      skill.owner,
      skill.name,
      skill.description,
      JSON.stringify(skill.plan),
      JSON.stringify(skill.inputSchema),
      skill.sourceDemoId,
      skill.createdAt,
      skill.updatedAt,
    ],
  });
  return skill;
}

/** Apply user edits from the review screen. */
export async function updateSkill(
  skillId: string,
  patch: Pick<Skill, "name" | "description" | "plan" | "inputSchema">,
): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE skills SET name = ?, description = ?, plan = ?, input_schema = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      patch.name,
      patch.description,
      JSON.stringify(patch.plan),
      JSON.stringify(patch.inputSchema),
      Date.now(),
      skillId,
    ],
  });
}

export async function getSkill(skillId: string): Promise<Skill | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE id = ?`,
    args: [skillId],
  });
  return r.rows[0] ? rowToSkill(r.rows[0]) : null;
}

export async function listSkills(owner: string): Promise<Skill[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE owner = ? ORDER BY updated_at DESC`,
    args: [owner],
  });
  return r.rows.map(rowToSkill);
}

function rowToSkill(row: Record<string, unknown>): Skill {
  return {
    id: String(row.id),
    owner: row.owner == null ? "" : String(row.owner),
    name: String(row.name),
    description: row.description == null ? "" : String(row.description),
    plan: JSON.parse(String(row.plan || "[]")) as SkillStep[],
    inputSchema: JSON.parse(String(row.input_schema || '{"fields":[]}')),
    sourceDemoId: row.source_demo_id == null ? null : String(row.source_demo_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
