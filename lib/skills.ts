import { db, ready } from "./db";
import { id } from "./ids";
import { keysetClause, toPage, type Page } from "./pagination";
import { skillTargets } from "./skill-utils";
import { listMyOrgs, roleOf } from "./orgs";
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
  /** Hosts the demo REALLY navigated to (derive from the recorded trace, not the
   *  model's plan). Falls back to the plan's targets only when not supplied. */
  allowedHosts?: string[];
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
    // Secure-by-default: restrict navigation to the hosts the demo actually
    // used (from the trusted recording when available, else the plan's targets).
    // Owner can widen/clear it in the editor; existing skills stay unrestricted
    // via the migration default.
    allowedHosts: (input.allowedHosts ?? skillTargets(plan)).filter(
      (h) => h !== "inline page",
    ),
    orgId: null,
    sourceDemoId: input.sourceDemoId,
    published: false,
    publishedAt: null,
    runCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute({
    sql: `INSERT INTO skills (id, owner, name, description, plan, input_schema, allowed_hosts, source_demo_id, published, published_at, run_count, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, 1, ?, ?)`,
    args: [
      skill.id,
      skill.owner,
      skill.name,
      skill.description,
      JSON.stringify(skill.plan),
      JSON.stringify(skill.inputSchema),
      JSON.stringify(skill.allowedHosts),
      skill.sourceDemoId,
      skill.createdAt,
      skill.updatedAt,
    ],
  });
  await snapshotVersion(skill);
  return skill;
}

export { categorize } from "./skill-utils";
export { skillTargets };

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
  patch: Pick<Skill, "name" | "description" | "plan" | "inputSchema"> & {
    allowedHosts?: string[];
  },
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
  // Keep the current allowlist unless the patch explicitly sets one.
  const allowedHosts = patch.allowedHosts ?? cur.allowedHosts;
  await db.execute({
    sql: `UPDATE skills SET name = ?, description = ?, plan = ?, input_schema = ?, allowed_hosts = ?, version = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      patch.name,
      patch.description,
      JSON.stringify(patch.plan),
      JSON.stringify(patch.inputSchema),
      JSON.stringify(allowedHosts),
      version,
      Date.now(),
      skillId,
    ],
  });
  await snapshotVersion({ id: skillId, version, ...patch });
}

/**
 * Self-healing: write operator-found selectors back into a skill's plan as the
 * new best-first option per step (deduped, capped). A lightweight plan update —
 * no version bump (heals can happen every scheduled run; we don't want version
 * spam). Returns how many steps actually changed.
 */
export async function learnSelectors(
  skillId: string,
  healed: Record<number, string>,
): Promise<number> {
  await ready();
  const cur = await getSkill(skillId);
  if (!cur) return 0;
  let changed = 0;
  const plan = cur.plan.map((s) => {
    const sel = healed[s.idx];
    if (!sel || s.selectors[0] === sel) return s; // nothing new for this step
    changed++;
    const selectors = [sel, ...s.selectors.filter((x) => x !== sel)].slice(0, 8);
    return { ...s, selectors };
  });
  if (changed === 0) return 0;
  await db.execute({
    sql: `UPDATE skills SET plan = ?, updated_at = ? WHERE id = ?`,
    args: [JSON.stringify(plan), Date.now(), skillId],
  });
  return changed;
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

/** Skills owned by the wallet PLUS any shared with an org it belongs to. */
export async function listSkills(owner: string): Promise<Skill[]> {
  await ready();
  const orgs = await listMyOrgs(owner);
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) {
    const r = await db.execute({
      sql: `SELECT * FROM skills WHERE owner = ? ORDER BY updated_at DESC`,
      args: [owner],
    });
    return r.rows.map(rowToSkill);
  }
  const ph = orgIds.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE owner = ? OR org_id IN (${ph})
          ORDER BY updated_at DESC`,
    args: [owner, ...orgIds],
  });
  return r.rows.map(rowToSkill);
}

/** What a wallet may do with a skill (personal owner, org sharing, or public). */
export async function skillAccess(
  skill: Skill,
  wallet: string,
): Promise<{ view: boolean; run: boolean; edit: boolean }> {
  if (skill.owner === wallet) return { view: true, run: true, edit: true };
  const role = skill.orgId ? await roleOf(skill.orgId, wallet) : null;
  const inOrg = role !== null;
  return {
    view: inOrg || skill.published,
    run: inOrg || skill.published,
    edit: role === "admin", // org admins can edit shared skills (creator already full)
  };
}

/** Share a skill with an org (or unshare with null). Owner only. */
export async function setSkillOrg(
  skillId: string,
  owner: string,
  orgId: string | null,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `UPDATE skills SET org_id = ?, updated_at = ? WHERE id = ? AND owner = ?`,
    args: [orgId, Date.now(), skillId, owner],
  });
  return r.rowsAffected > 0;
}

function rowToSkill(row: Record<string, unknown>): Skill {
  return {
    id: String(row.id),
    owner: row.owner == null ? "" : String(row.owner),
    name: String(row.name),
    description: row.description == null ? "" : String(row.description),
    plan: JSON.parse(String(row.plan || "[]")) as SkillStep[],
    inputSchema: JSON.parse(String(row.input_schema || '{"fields":[]}')),
    allowedHosts: JSON.parse(String(row.allowed_hosts || "[]")) as string[],
    orgId: row.org_id == null ? null : String(row.org_id),
    sourceDemoId: row.source_demo_id == null ? null : String(row.source_demo_id),
    published: Number(row.published) === 1,
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    runCount: Number(row.run_count ?? 0),
    version: Number(row.version ?? 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
