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
    published: false,
    publishedAt: null,
    runCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO skills (id, owner, name, description, plan, input_schema, source_demo_id, published, published_at, run_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)`,
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

/** Publish or unpublish a skill to the marketplace (owner only). */
export async function setPublished(
  skillId: string,
  owner: string,
  published: boolean,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE skills SET published = ?, published_at = ?, updated_at = ?
          WHERE id = ? AND owner = ?`,
    args: [published ? 1 : 0, published ? Date.now() : null, Date.now(), skillId, owner],
  });
  return r.rowsAffected > 0;
}

/** Bump a skill's run counter (marketplace popularity). */
export async function incrementRunCount(skillId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE skills SET run_count = run_count + 1 WHERE id = ?`,
    args: [skillId],
  });
}

/** Published skills for the public marketplace, most-run first. */
export async function listPublishedSkills(limit = 50): Promise<Skill[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE published = 1
          ORDER BY run_count DESC, published_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map(rowToSkill);
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
    published: Number(row.published) === 1,
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    runCount: Number(row.run_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
