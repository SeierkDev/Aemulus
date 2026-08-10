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

/** Retained version snapshots per skill (bounds skill_versions growth from an edit
 *  loop) and the per-owner active-skill cap (bounds skills growth), mirroring the
 *  triggers/webhooks/schedules per-owner caps. */
export const MAX_VERSION_HISTORY = 100;
export const MAX_SKILLS_PER_OWNER = 500;

/** Count of skills a wallet owns — for the create cap. */
export async function countSkillsByOwner(owner: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM skills WHERE owner = ?`,
    args: [owner],
  });
  return Number((r.rows[0] as Record<string, unknown>).c);
}

/** A marketplace "template": a starter skill with placeholder steps that a user
 *  records their own version of (e.g. "Add invoice to QuickBooks"). It is NOT
 *  runnable as-is - selectors are illustrative. Returns the tool name, or null
 *  for an ordinary runnable skill. */
export function templateTool(skill: {
  inputSchema?: { template?: { tool?: unknown } | null } | null;
}): string | null {
  const t = skill.inputSchema?.template?.tool;
  return typeof t === "string" && t.trim() ? t : null;
}

/** Parse a JSON column without throwing out of a read path. `|| "[]"` only
 *  covers NULL/empty; a corrupt (truncated/malformed) value still throws. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

/** Snapshot a skill's content into its version history. */
async function snapshotVersion(s: {
  id: string;
  version: number;
  name: string;
  description: string;
  plan: SkillStep[];
  inputSchema: { fields: SkillInputField[] };
  allowedHosts?: string[];
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO skill_versions (id, skill_id, version, name, description, plan, input_schema, allowed_hosts, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id("skv"),
      s.id,
      s.version,
      s.name,
      s.description,
      JSON.stringify(s.plan),
      JSON.stringify(s.inputSchema),
      // Snapshot the egress allowlist so a restore reproduces it (an empty array
      // is a real value — "unrestricted" — distinct from a legacy NULL snapshot).
      JSON.stringify(s.allowedHosts ?? []),
      Date.now(),
    ],
  });
  // Bound version history: a snapshot is appended on create AND on every edit/restore,
  // so an unthrottled edit loop would grow skill_versions without limit (each row holds
  // the full plan + input_schema JSON). Keep only the most recent MAX_VERSION_HISTORY
  // per skill; restore still works within that window.
  await db.execute({
    sql: `DELETE FROM skill_versions
          WHERE skill_id = ?
            AND version <= (SELECT MAX(version) - ? FROM skill_versions WHERE skill_id = ?)`,
    args: [s.id, MAX_VERSION_HISTORY, s.id],
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

export class SkillNotPublishableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkillNotPublishableError";
  }
}

/** Why a skill can't be published (it wouldn't run), or null if it's fine. The
 *  schema alone allows a 0-step plan and `input` steps bound to keys that aren't
 *  declared fields — such a skill would sit unrunnable in the marketplace. */
export function unpublishableReason(skill: Skill): string | null {
  if (!skill.plan || skill.plan.length === 0) return "This skill has no steps to run.";
  const fieldKeys = new Set((skill.inputSchema?.fields ?? []).map((f) => f.key).filter(Boolean));
  for (const s of skill.plan) {
    if (s.valueSource === "input") {
      if (!s.inputKey) return "A step expects an input but no input field is set.";
      if (!fieldKeys.has(s.inputKey)) {
        return `A step references an input "${s.inputKey}" that isn't one of the skill's input fields.`;
      }
    }
  }
  return null;
}

/** Publish or unpublish a skill to the marketplace (owner only). Publishing an
 *  unrunnable skill is refused (throws SkillNotPublishableError). */
export async function setPublished(
  skillId: string,
  owner: string,
  published: boolean,
): Promise<boolean> {
  await ready();
  if (published) {
    const skill = await getSkill(skillId);
    // Validate only a skill this owner actually owns; a missing/foreign skill
    // falls through to the ownership-scoped UPDATE, which returns false as before.
    if (skill && skill.owner === owner) {
      const reason = unpublishableReason(skill);
      if (reason) throw new SkillNotPublishableError(reason);
    }
  }
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

/**
 * Published skills by id, in ONE query, keyed for lookup.
 *
 * For the curated shelf, which knows the ids it wants and needs them ordered
 * the way a curator chose rather than the way SQL feels like returning them —
 * so this hands back a Map and lets the caller do the ordering. Republishes the
 * `published = 1` filter rather than trusting the caller's ids.
 */
export async function publishedSkillsByIds(ids: string[]): Promise<Map<string, Skill>> {
  await ready();
  const out = new Map<string, Skill>();
  // Bounded: the placeholder list goes straight into the SQL, so a caller that
  // one day hands over a huge id array must not be able to build a huge query.
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 1000);
  if (!unique.length) return out;
  const holes = unique.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE published = 1 AND id IN (${holes})`,
    args: unique,
  });
  for (const row of r.rows) {
    const s = rowToSkill(row);
    out.set(s.id, s);
  }
  return out;
}

/** Total number of published skills on the platform. */
export async function countPublishedSkills(): Promise<number> {
  await ready();
  const r = await db.execute(`SELECT COUNT(*) AS n FROM skills WHERE published = 1`);
  return Number(r.rows[0]?.n ?? 0);
}

/** Lightweight published-skill rows for related-discovery cards: selects only the
 *  display columns so we don't JSON-parse every skill's plan/schema just to show
 *  a few "related" cards. */
export interface SkillLite {
  id: string;
  name: string;
  description: string;
  owner: string;
  runCount: number;
}
export async function listPublishedSkillsLite(limit = 100): Promise<SkillLite[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, name, description, owner, run_count FROM skills
          WHERE published = 1 ORDER BY run_count DESC, published_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    description: String(x.description ?? ""),
    owner: String(x.owner),
    runCount: Number(x.run_count ?? 0),
  }));
}

/** Published skills, cursor-paginated (newest first) for the public API. */
/**
 * Search published skills by name/description across ALL of them (not just the
 * top-N a plain list returns), so discovery scales past the first page. LIKE
 * wildcards in the user's query are escaped so a literal "%" can't match-all.
 */
export async function searchPublishedSkills(
  query: string,
  limit = 50,
): Promise<Skill[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return listPublishedSkills(limit);
  await ready();
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const r = await db.execute({
    sql: `SELECT * FROM skills WHERE published = 1
          AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
          ORDER BY run_count DESC, published_at DESC LIMIT ?`,
    args: [like, like, limit],
  });
  return r.rows.map(rowToSkill);
}

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
  // If this edit (or a version restore, which routes through here) makes a PUBLISHED
  // skill unrunnable — 0 steps, or an input step bound to a field the patch no longer
  // declares — auto-unpublish it. Otherwise the edit/restore path silently bypasses
  // setPublished's guard and leaves a broken skill live in the marketplace.
  const nextState = { ...cur, plan: patch.plan, inputSchema: patch.inputSchema } as Skill;
  const unpublish = cur.published && unpublishableReason(nextState) !== null;
  await db.execute({
    sql: `UPDATE skills SET name = ?, description = ?, plan = ?, input_schema = ?, allowed_hosts = ?, version = ?, updated_at = ?${
      unpublish ? ", published = 0, published_at = NULL" : ""
    } WHERE id = ?`,
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
  await snapshotVersion({ id: skillId, version, ...patch, allowedHosts });
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
    sql: `SELECT name, description, plan, input_schema, allowed_hosts FROM skill_versions
          WHERE skill_id = ? AND version = ?`,
    args: [skillId, version],
  });
  const row = r.rows[0];
  if (!row) return false;
  // Restore the snapshotted egress allowlist too. A legacy snapshot (NULL) predates
  // the column, so leave it undefined → updateSkill keeps the current allowlist
  // rather than wrongly clearing it.
  const restoredHosts =
    row.allowed_hosts == null ? undefined : parseJson<string[]>(String(row.allowed_hosts), []);
  await updateSkill(skillId, {
    name: String(row.name),
    description: row.description == null ? "" : String(row.description),
    // Defensive fallbacks (mirror rowToSkill) so a NULL/corrupt snapshot column
    // can't throw an uncaught 500 out of a restore.
    plan: parseJson<SkillStep[]>(row.plan, []),
    inputSchema: parseJson<{ fields: SkillInputField[] }>(row.input_schema, { fields: [] }),
    ...(restoredHosts !== undefined ? { allowedHosts: restoredHosts } : {}),
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
    // EDIT IS OWNER-ONLY. An org member sharing a skill grants teammates view+run,
    // NOT the right to rewrite its executable plan in place: a non-owner edit
    // mutates the single skills row, so a tampered plan would reach the owner's own
    // vault-enabled runs AND (if published) every marketplace runner. Collaborative
    // editing, if wanted, must be a fork/propose flow — never an in-place mutation.
    edit: false,
  };
}

/**
 * Take someone else's published skill and make it yours to change.
 *
 * A COPY, not a reference. The marketplace was read-only in practice: run what
 * is there, or record your own from nothing. A skill that is nearly right for
 * your supplier portal was a dead end, so the half-right ones died instead of
 * becoming five better ones.
 *
 * The copy is deliberately complete and deliberately detached — plan, inputs
 * and allowed hosts come across, and nothing links back at run time. The
 * original's author can edit, unpublish or abandon their skill and every fork
 * keeps working. What survives is provenance: which skill this came from, so
 * the listing can say where it started and the original can show what it
 * spawned.
 *
 * What does NOT come across: the publish flag (a fork starts private, because
 * publishing someone else's work under your name should be a decision, not a
 * default), the run count and rating (they were earned by the original), the
 * org share, and the source recording (it is the original author's, and it can
 * hold what their browser saw).
 */
export async function forkSkill(
  skillId: string,
  owner: string,
): Promise<{ id: string } | { refused: string }> {
  await ready();
  const src = await getSkill(skillId);
  if (!src) return { refused: "That skill no longer exists." };
  // A template is placeholder steps for a tool, not something that runs. The
  // whole point of one is that you record your own version, so a copy of the
  // placeholders is a skill that can never do anything — offering it would be
  // offering a dead end dressed as a shortcut.
  if (templateTool(src)) {
    return { refused: "That's a starter template — record your own version instead of forking it." };
  }
  // The cap every other creation path enforces. Forking bypassed it by writing
  // the row directly, and it is the CHEAPEST way to make a skill — no
  // recording, no model call — so it was the easiest way to walk past the bound
  // that exists to keep this table from growing without one.
  if ((await countSkillsByOwner(owner)) >= MAX_SKILLS_PER_OWNER) {
    return { refused: `You already have ${MAX_SKILLS_PER_OWNER} skills, which is the limit.` };
  }
  // Forkable = runnable by you. Published, or shared with an org you are in, or
  // already yours — the same authority every other path asks.
  if (!(await skillAccess(src, owner)).run) {
    return { refused: "That skill isn't yours to fork." };
  }
  const now = Date.now();
  const forkId = id("skl");
  await db.execute({
    sql: `INSERT INTO skills (id, owner, name, description, plan, input_schema, allowed_hosts, source_demo_id, published, published_at, run_count, version, forked_from, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, 0, 1, ?, ?, ?)`,
    args: [
      forkId,
      owner,
      // Named for what it is. Left identical, a marketplace of forks is a list
      // of the same title over and over and nobody can tell them apart.
      `${src.name} (fork)`.slice(0, 200),
      src.description,
      JSON.stringify(src.plan),
      JSON.stringify(src.inputSchema),
      JSON.stringify(src.allowedHosts),
      src.id,
      now,
      now,
    ],
  });
  // Snapshot v1, exactly as creating a skill does.
  //
  // Without it the fork had no history at all: the editor's version panel was
  // empty, and updateSkill derives the next version from the highest SNAPSHOT —
  // so the first edit wrote another v1, holding the edited state. The plan you
  // forked was then unrecoverable, which is the one version a fork most needs,
  // since the reason to fork is that you are about to change it.
  await snapshotVersion({
    id: forkId,
    version: 1,
    name: `${src.name} (fork)`.slice(0, 200),
    description: src.description,
    plan: src.plan,
    inputSchema: src.inputSchema,
    allowedHosts: src.allowedHosts,
  });
  return { id: forkId };
}

/** How many skills were forked from this one. */
export async function forkCount(skillId: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM skills WHERE forked_from = ?`,
    args: [skillId],
  });
  return Number(r.rows[0]?.n ?? 0);
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
    plan: parseJson<SkillStep[]>(row.plan, []),
    inputSchema: parseJson<{ fields: SkillInputField[] }>(row.input_schema, { fields: [] }),
    allowedHosts: parseJson<string[]>(row.allowed_hosts, []),
    orgId: row.org_id == null ? null : String(row.org_id),
    forkedFrom: row.forked_from == null ? null : String(row.forked_from),
    sourceDemoId: row.source_demo_id == null ? null : String(row.source_demo_id),
    published: Number(row.published) === 1,
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    runCount: Number(row.run_count ?? 0),
    version: Number(row.version ?? 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
