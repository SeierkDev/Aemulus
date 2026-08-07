import { db, ready } from "./db";
import { id } from "./ids";

/**
 * Curated marketplace collections + editorial spotlights.
 *
 * Search and auto-categories answer "find the thing I already know about".
 * These answer "show me what is worth running", which is a different question
 * and cannot be derived — someone has to choose. So this is the editorial
 * layer: a small set of wallets may group published skills into named
 * collections and put a few of them in a spotlight.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a curated entry is a POINTER, never a
 * copy. Publication is re-checked on every read, so a skill that its owner
 * unpublished — or that the community reported into a takedown (see
 * lib/moderation.ts, which flips `published` and nothing else) — stops
 * appearing immediately. Curation must not be a way for removed content to
 * stay on the front page.
 */

/** Wallets allowed to curate. Same env-configured shape as AEMULUS_VERIFIED. */
function curators(): Set<string> {
  return new Set(
    (process.env.AEMULUS_CURATORS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * May this wallet curate?
 *
 * Fails CLOSED when unset. An empty allowlist means nobody, not everybody — the
 * opposite reading would hand the marketplace's front page to any wallet the
 * moment the variable was missing from an environment.
 */
export function isCurator(wallet: string): boolean {
  if (!wallet) return false;
  return curators().has(wallet);
}

/** Bounds, so a curator can't turn the front page into an unbounded query. */
export const MAX_COLLECTIONS = 24;
export const MAX_SKILLS_PER_COLLECTION = 24;
export const MAX_SPOTLIGHTS = 4;
const MAX_TITLE = 60;
const MAX_BLURB = 200;
const MAX_SLUG = 40;

/**
 * Normalize a slug, or return null if nothing usable survives.
 *
 * Lowercase, ASCII, dashes. The slug goes in a URL and is matched exactly, so
 * anything that could collapse two different-looking slugs onto one string
 * (case, doubled dashes, edge dashes) is normalized here rather than left for
 * the unique index to reject at insert time with a confusing error.
 */
export function normalizeSlug(raw: string): string | null {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG)
    // slice can leave a trailing dash behind; strip it again after truncating
    .replace(/-$/, "");
  return s.length ? s : null;
}

export type Collection = {
  id: string;
  slug: string;
  title: string;
  blurb: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

/** A collection with the ids of the published skills currently in it. */
export type CollectionWithSkills = Collection & { skillIds: string[] };

export type Spotlight = { skillId: string; blurb: string; position: number };

function toCollection(r: Record<string, unknown>): Collection {
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    blurb: String(r.blurb ?? ""),
    position: Number(r.position ?? 0),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

export async function listCollections(): Promise<Collection[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM collections ORDER BY position ASC, created_at ASC LIMIT ?`,
    args: [MAX_COLLECTIONS],
  });
  return r.rows.map((x) => toCollection(x as unknown as Record<string, unknown>));
}

export async function getCollectionBySlug(slug: string): Promise<Collection | null> {
  await ready();
  const s = normalizeSlug(slug);
  if (!s) return null;
  const r = await db.execute({ sql: `SELECT * FROM collections WHERE slug = ?`, args: [s] });
  const row = r.rows[0];
  return row ? toCollection(row as unknown as Record<string, unknown>) : null;
}

/**
 * Collections with their members, in one pass.
 *
 * The join filters on skills.published rather than trusting collection_skills,
 * which is the whole point of this module. Empty collections are dropped: a
 * heading with nothing under it reads as a broken page, and after a takedown
 * that is exactly what a collection can become.
 */
export async function listCollectionsWithSkills(): Promise<CollectionWithSkills[]> {
  await ready();
  const cols = await listCollections();
  if (!cols.length) return [];
  // Scoped to the collections that exist, so membership rows orphaned by a
  // half-finished delete are never scanned, and the row count stays bounded by
  // the two caps rather than by whatever is in the table.
  const holes = cols.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT cs.collection_id AS cid, cs.skill_id AS sid
          FROM collection_skills cs
          JOIN skills s ON s.id = cs.skill_id AND s.published = 1
          WHERE cs.collection_id IN (${holes})
          ORDER BY cs.position ASC, cs.created_at ASC`,
    args: cols.map((c) => c.id),
  });
  const byCol = new Map<string, string[]>();
  for (const row of r.rows) {
    const cid = String((row as unknown as Record<string, unknown>).cid);
    const sid = String((row as unknown as Record<string, unknown>).sid);
    const list = byCol.get(cid) ?? [];
    if (list.length < MAX_SKILLS_PER_COLLECTION) list.push(sid);
    byCol.set(cid, list);
  }
  return cols
    .map((c) => ({ ...c, skillIds: byCol.get(c.id) ?? [] }))
    .filter((c) => c.skillIds.length > 0);
}

/** The published skill ids in one collection, in curated order. */
export async function collectionSkillIds(collectionId: string): Promise<string[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT cs.skill_id AS sid FROM collection_skills cs
          JOIN skills s ON s.id = cs.skill_id AND s.published = 1
          WHERE cs.collection_id = ?
          ORDER BY cs.position ASC, cs.created_at ASC LIMIT ?`,
    args: [collectionId, MAX_SKILLS_PER_COLLECTION],
  });
  return r.rows.map((x) => String((x as unknown as Record<string, unknown>).sid));
}

/** Create a collection. Returns null when the slug is unusable or taken. */
export async function createCollection(input: {
  slug: string;
  title: string;
  blurb?: string;
  position?: number;
}): Promise<Collection | null> {
  await ready();
  const slug = normalizeSlug(input.slug);
  const title = String(input.title ?? "").trim().slice(0, MAX_TITLE);
  if (!slug || !title) return null;
  const total = await db.execute(`SELECT COUNT(*) AS n FROM collections`);
  if (Number(total.rows[0]?.n ?? 0) >= MAX_COLLECTIONS) return null;
  if (await getCollectionBySlug(slug)) return null;
  const now = Date.now();
  const cid = id("col");
  await db.execute({
    sql: `INSERT INTO collections (id, slug, title, blurb, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      cid,
      slug,
      title,
      String(input.blurb ?? "").trim().slice(0, MAX_BLURB),
      Math.trunc(Number(input.position) || 0),
      now,
      now,
    ],
  });
  return {
    id: cid,
    slug,
    title,
    blurb: String(input.blurb ?? "").trim().slice(0, MAX_BLURB),
    position: Math.trunc(Number(input.position) || 0),
    createdAt: now,
    updatedAt: now,
  };
}

/** Rename / re-blurb / re-order. Only the fields supplied are touched. */
export async function updateCollection(
  collectionId: string,
  patch: { title?: string; blurb?: string; position?: number },
): Promise<boolean> {
  await ready();
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, MAX_TITLE);
    if (!t) return false;
    sets.push("title = ?");
    args.push(t);
  }
  if (patch.blurb !== undefined) {
    sets.push("blurb = ?");
    args.push(String(patch.blurb).trim().slice(0, MAX_BLURB));
  }
  if (patch.position !== undefined) {
    sets.push("position = ?");
    args.push(Math.trunc(Number(patch.position) || 0));
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  args.push(Date.now(), collectionId);
  const r = await db.execute({
    sql: `UPDATE collections SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
  return r.rowsAffected > 0;
}

/** Delete a collection and its membership rows. */
export async function deleteCollection(collectionId: string): Promise<boolean> {
  await ready();
  // Members first: a crash between the two leaves orphan rows that no read path
  // can reach, which is harmless. The other order would leave a live collection
  // pointing at nothing, which shows up as an empty heading.
  await db.execute({
    sql: `DELETE FROM collection_skills WHERE collection_id = ?`,
    args: [collectionId],
  });
  const r = await db.execute({ sql: `DELETE FROM collections WHERE id = ?`, args: [collectionId] });
  return r.rowsAffected > 0;
}

/**
 * Put a skill in a collection.
 *
 * Refuses a skill that is not currently published. This is a convenience for
 * the curator, not a security boundary — the read path re-checks anyway,
 * because a skill published today can be taken down tomorrow.
 */
export async function addToCollection(
  collectionId: string,
  skillId: string,
  position = 0,
): Promise<boolean> {
  await ready();
  const col = await db.execute({
    sql: `SELECT id FROM collections WHERE id = ?`,
    args: [collectionId],
  });
  if (!col.rows.length) return false;
  const sk = await db.execute({
    sql: `SELECT id FROM skills WHERE id = ? AND published = 1`,
    args: [skillId],
  });
  if (!sk.rows.length) return false;
  const n = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM collection_skills WHERE collection_id = ?`,
    args: [collectionId],
  });
  // Counted before the insert, and an existing member re-added is an UPDATE of
  // its position rather than a new row — so re-ordering a full collection does
  // not fail on its own size cap.
  const already = await db.execute({
    sql: `SELECT 1 FROM collection_skills WHERE collection_id = ? AND skill_id = ?`,
    args: [collectionId, skillId],
  });
  if (!already.rows.length && Number(n.rows[0]?.n ?? 0) >= MAX_SKILLS_PER_COLLECTION) {
    return false;
  }
  await db.execute({
    sql: `INSERT INTO collection_skills (collection_id, skill_id, position, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(collection_id, skill_id) DO UPDATE SET position = excluded.position`,
    args: [collectionId, skillId, Math.trunc(Number(position) || 0), Date.now()],
  });
  return true;
}

export async function removeFromCollection(
  collectionId: string,
  skillId: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `DELETE FROM collection_skills WHERE collection_id = ? AND skill_id = ?`,
    args: [collectionId, skillId],
  });
  return r.rowsAffected > 0;
}

/** The spotlight, filtered to what is still published. */
export async function listSpotlights(): Promise<Spotlight[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT sp.skill_id AS sid, sp.blurb AS blurb, sp.position AS pos
          FROM spotlights sp
          JOIN skills s ON s.id = sp.skill_id AND s.published = 1
          ORDER BY sp.position ASC, sp.created_at ASC LIMIT ?`,
    args: [MAX_SPOTLIGHTS],
  });
  return r.rows.map((x) => {
    const row = x as unknown as Record<string, unknown>;
    return {
      skillId: String(row.sid),
      blurb: String(row.blurb ?? ""),
      position: Number(row.pos ?? 0),
    };
  });
}

export async function setSpotlight(
  skillId: string,
  blurb: string,
  position = 0,
): Promise<boolean> {
  await ready();
  const sk = await db.execute({
    sql: `SELECT id FROM skills WHERE id = ? AND published = 1`,
    args: [skillId],
  });
  if (!sk.rows.length) return false;
  const already = await db.execute({
    sql: `SELECT 1 FROM spotlights WHERE skill_id = ?`,
    args: [skillId],
  });
  if (!already.rows.length) {
    const n = await db.execute(`SELECT COUNT(*) AS n FROM spotlights`);
    if (Number(n.rows[0]?.n ?? 0) >= MAX_SPOTLIGHTS) return false;
  }
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO spotlights (skill_id, blurb, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(skill_id) DO UPDATE SET
            blurb = excluded.blurb, position = excluded.position, updated_at = excluded.updated_at`,
    args: [skillId, String(blurb ?? "").trim().slice(0, MAX_BLURB), Math.trunc(Number(position) || 0), now, now],
  });
  return true;
}

export async function clearSpotlight(skillId: string): Promise<boolean> {
  await ready();
  const r = await db.execute({ sql: `DELETE FROM spotlights WHERE skill_id = ?`, args: [skillId] });
  return r.rowsAffected > 0;
}
