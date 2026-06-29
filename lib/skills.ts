import { db, ready } from "./db";
import { id } from "./ids";
import { keysetClause, toPage, type Page } from "./pagination";
import type {
  GeneralizedSkill,
  Skill,
  SkillInputField,
  SkillStep,
  SkillVersionMeta,
} from "./types";

/** Snapshot a skill's content into its version history. */
async function snapshotVersion(s: {
  id: string;
  version: number;
  name: string;
  description: string;
  plan: SkillStep[];
  inputSchema: { fields: SkillInputField[] };
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO skill_versions (id, skill_id, version, name, description, plan, input_schema, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id("skv"),
      s.id,
      s.version,
      s.name,
      s.description,
      JSON.stringify(s.plan),
      JSON.stringify(s.inputSchema),
      Date.now(),
    ],
  });
}

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
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO skills (id, owner, name, description, plan, input_schema, source_demo_id, published, published_at, run_count, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, 1, ?, ?)`,
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
  await snapshotVersion(skill);
  return skill;
}

export { skillTargets, categorize } from "./skill-utils";

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

/** Published skills, cursor-paginated (newest first) for the public API. */
export async function listPublishedSkillsPage(
  limit: number,
  cursor: { createdAt: number; id: string } | null,
): Promise<Page<Skill>> {
  await ready();
  const { clause, args } = keysetClause(cursor);
  const where = `published = 1${clause ? ` AND ${clause}` : ""}`;
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE ${where}
          ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [...args, limit + 1],
  });
  return toPage(r.rows.map(rowToSkill), limit, (s) => ({
    createdAt: s.createdAt,
    id: s.id,
  }));
}

/** Apply user edits from the review screen. */
export async function updateSkill(
  skillId: string,
  patch: Pick<Skill, "name" | "description" | "plan" | "inputSchema">,
): Promise<void> {
  await ready();
  const cur = await getSkill(skillId);
  if (!cur) return;
  // Derive the next version from the snapshot table's MAX, not the cached
  // skills.version, so it stays correct; the UNIQUE(skill_id,version) index
  // makes a concurrent collision fail loudly (caller retries) instead of
  // silently duplicating a version.
  const maxRow = await db.execute({
    sql: `SELECT COALESCE(MAX(version),0) AS v FROM skill_versions WHERE skill_id = ?`,
    args: [skillId],
  });
  const version = Number(maxRow.rows[0]?.v ?? 0) + 1;
  await db.execute({
    sql: `UPDATE skills SET name = ?, description = ?, plan = ?, input_schema = ?, version = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      patch.name,
      patch.description,
      JSON.stringify(patch.plan),
      JSON.stringify(patch.inputSchema),
      version,
      Date.now(),
      skillId,
    ],
  });
  await snapshotVersion({ id: skillId, version, ...patch });
}

/** Version history (newest first) for a skill. */
export async function listSkillVersions(
  skillId: string,
): Promise<SkillVersionMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT version, name, description, created_at FROM skill_versions
          WHERE skill_id = ? ORDER BY version DESC`,
    args: [skillId],
  });
  return r.rows.map((x) => ({
    version: Number(x.version),
    name: String(x.name),
    description: x.description == null ? "" : String(x.description),
    createdAt: Number(x.created_at),
  }));
}

/**
 * Restore a prior version: copies that snapshot back as a NEW latest version
 * (history is append-only, so a restore is itself recorded).
 */
export async function restoreSkillVersion(
  skillId: string,
  version: number,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `SELECT name, description, plan, input_schema FROM skill_versions
          WHERE skill_id = ? AND version = ?`,
    args: [skillId, version],
  });
  const row = r.rows[0];
  if (!row) return false;
  await updateSkill(skillId, {
    name: String(row.name),
    description: row.description == null ? "" : String(row.description),
    // Defensive fallbacks (mirror rowToSkill) so a NULL/corrupt snapshot column
    // can't throw an uncaught 500 out of a restore.
    plan: JSON.parse(String(row.plan || "[]")),
    inputSchema: JSON.parse(String(row.input_schema || '{"fields":[]}')),
  });
  return true;
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
    version: Number(row.version ?? 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
