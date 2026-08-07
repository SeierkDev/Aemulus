import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { ready, db } from "../../lib/db";
import { createSkill, setPublished, publishedSkillsByIds } from "../../lib/skills";
import {
  addToCollection,
  clearSpotlight,
  collectionSkillIds,
  createCollection,
  deleteCollection,
  isCurator,
  listCollectionsWithSkills,
  listSpotlights,
  normalizeSlug,
  removeFromCollection,
  setSpotlight,
  updateCollection,
  MAX_SKILLS_PER_COLLECTION,
  MAX_SPOTLIGHTS,
} from "../../lib/collections";
import type { GeneralizedSkill } from "../../lib/types";

const OWNER = "WALLET_CURATE";

function gen(name: string): GeneralizedSkill {
  return {
    name,
    description: `desc for ${name}`,
    inputFields: [],
    steps: [
      {
        intent: "open",
        action: "navigate",
        selectors: [],
        target: "data:text/html,<p>x</p>",
        valueSource: "none",
        value: "",
      },
    ],
  } as unknown as GeneralizedSkill;
}

async function makeSkill(name: string, publish = true) {
  const s = await createSkill({ owner: OWNER, generalized: gen(name), sourceDemoId: null });
  if (publish) await setPublished(s.id, OWNER, true);
  return s.id;
}

beforeAll(async () => {
  await ready();
});

beforeEach(async () => {
  await db.execute(`DELETE FROM collection_skills`);
  await db.execute(`DELETE FROM collections`);
  await db.execute(`DELETE FROM spotlights`);
});

describe("normalizeSlug", () => {
  it("folds case, spaces and punctuation into one canonical form", () => {
    expect(normalizeSlug("  Crypto & Portfolios!  ")).toBe("crypto-portfolios");
    expect(normalizeSlug("A--B")).toBe("a-b");
    expect(normalizeSlug("-lead-")).toBe("lead");
  });

  it("returns null when nothing usable survives", () => {
    expect(normalizeSlug("")).toBeNull();
    expect(normalizeSlug("   ")).toBeNull();
    expect(normalizeSlug("!!!")).toBeNull();
  });

  it("never leaves a trailing dash after truncation", () => {
    // 39 chars then a separator: the slice lands exactly on the dash, and a
    // second strip is what keeps "…a-" from becoming a distinct slug.
    const raw = `${"a".repeat(39)} b`;
    const s = normalizeSlug(raw)!;
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("isCurator", () => {
  const saved = process.env.AEMULUS_CURATORS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AEMULUS_CURATORS;
    else process.env.AEMULUS_CURATORS = saved;
  });

  it("fails closed when unset", () => {
    delete process.env.AEMULUS_CURATORS;
    expect(isCurator(OWNER)).toBe(false);
    expect(isCurator("")).toBe(false);
  });

  it("admits only the listed wallets", () => {
    process.env.AEMULUS_CURATORS = ` ${OWNER} , OTHER `;
    expect(isCurator(OWNER)).toBe(true);
    expect(isCurator("OTHER")).toBe(true);
    expect(isCurator("SOMEONE_ELSE")).toBe(false);
  });
});

describe("collections", () => {
  it("creates, updates and deletes", async () => {
    const c = await createCollection({ slug: "Money Things", title: "Finance", blurb: "b" });
    expect(c?.slug).toBe("money-things");
    expect(await updateCollection(c!.id, { title: "Finance & billing" })).toBe(true);
    expect(await updateCollection(c!.id, {})).toBe(false);
    expect(await deleteCollection(c!.id)).toBe(true);
    expect(await deleteCollection(c!.id)).toBe(false);
  });

  it("refuses a duplicate slug, however it was spelled", async () => {
    expect(await createCollection({ slug: "finance", title: "A" })).not.toBeNull();
    expect(await createCollection({ slug: "  FINANCE  ", title: "B" })).toBeNull();
  });

  it("refuses a collection with no usable slug or title", async () => {
    expect(await createCollection({ slug: "!!!", title: "A" })).toBeNull();
    expect(await createCollection({ slug: "ok", title: "   " })).toBeNull();
  });

  it("only takes published skills, and keeps curated order", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const a = await makeSkill("Alpha");
    const b = await makeSkill("Beta");
    const draft = await makeSkill("Draft", false);

    expect(await addToCollection(c.id, b, 1)).toBe(true);
    expect(await addToCollection(c.id, a, 0)).toBe(true);
    expect(await addToCollection(c.id, draft, 2)).toBe(false);
    expect(await addToCollection("col_missing", a, 0)).toBe(false);

    expect(await collectionSkillIds(c.id)).toEqual([a, b]);
  });

  // The rule the whole module exists for.
  it("drops a skill from the shelf the moment it is unpublished", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const a = await makeSkill("Alpha");
    const b = await makeSkill("Beta");
    await addToCollection(c.id, a, 0);
    await addToCollection(c.id, b, 1);
    expect(await collectionSkillIds(c.id)).toEqual([a, b]);

    // A takedown (lib/moderation) flips exactly this column and nothing else.
    await db.execute({ sql: `UPDATE skills SET published = 0 WHERE id = ?`, args: [a] });

    expect(await collectionSkillIds(c.id)).toEqual([b]);
    const shelf = await listCollectionsWithSkills();
    expect(shelf[0]?.skillIds).toEqual([b]);
  });

  it("hides a collection whose members have all gone", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const a = await makeSkill("Alpha");
    await addToCollection(c.id, a, 0);
    expect(await listCollectionsWithSkills()).toHaveLength(1);

    await db.execute({ sql: `UPDATE skills SET published = 0 WHERE id = ?`, args: [a] });
    // A heading with nothing under it reads as a broken page.
    expect(await listCollectionsWithSkills()).toHaveLength(0);
  });

  it("re-adding a member moves it instead of adding a row", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const a = await makeSkill("Alpha");
    const b = await makeSkill("Beta");
    await addToCollection(c.id, a, 0);
    await addToCollection(c.id, b, 1);
    await addToCollection(c.id, a, 9); // move Alpha to the end
    expect(await collectionSkillIds(c.id)).toEqual([b, a]);
  });

  it("caps membership, but re-ordering a full collection still works", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const ids: string[] = [];
    for (let i = 0; i < MAX_SKILLS_PER_COLLECTION; i++) {
      const sid = await makeSkill(`S${i}`);
      ids.push(sid);
      expect(await addToCollection(c.id, sid, i)).toBe(true);
    }
    const overflow = await makeSkill("Overflow");
    expect(await addToCollection(c.id, overflow, 99)).toBe(false);
    // An existing member is an UPDATE, so the size cap must not block it.
    expect(await addToCollection(c.id, ids[0], 99)).toBe(true);
  });

  it("removes a member without touching the collection", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const a = await makeSkill("Alpha");
    await addToCollection(c.id, a, 0);
    expect(await removeFromCollection(c.id, a)).toBe(true);
    expect(await removeFromCollection(c.id, a)).toBe(false);
    expect(await collectionSkillIds(c.id)).toEqual([]);
  });

  it("deleting a collection takes its membership rows with it", async () => {
    const c = (await createCollection({ slug: "c", title: "C" }))!;
    const a = await makeSkill("Alpha");
    await addToCollection(c.id, a, 0);
    await deleteCollection(c.id);
    const left = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM collection_skills WHERE collection_id = ?`,
      args: [c.id],
    });
    expect(Number(left.rows[0]?.n ?? 0)).toBe(0);
  });
});

describe("spotlights", () => {
  it("features a published skill and carries the curator's line", async () => {
    const a = await makeSkill("Alpha");
    expect(await setSpotlight(a, "why this one", 0)).toBe(true);
    const list = await listSpotlights();
    expect(list).toEqual([{ skillId: a, blurb: "why this one", position: 0 }]);
  });

  it("refuses an unpublished skill", async () => {
    const draft = await makeSkill("Draft", false);
    expect(await setSpotlight(draft, "x", 0)).toBe(false);
  });

  it("drops a feature the moment the skill is unpublished", async () => {
    const a = await makeSkill("Alpha");
    await setSpotlight(a, "x", 0);
    await db.execute({ sql: `UPDATE skills SET published = 0 WHERE id = ?`, args: [a] });
    expect(await listSpotlights()).toEqual([]);
  });

  it("re-featuring updates rather than filling the slot twice", async () => {
    const a = await makeSkill("Alpha");
    await setSpotlight(a, "first", 0);
    expect(await setSpotlight(a, "second", 3)).toBe(true);
    const list = await listSpotlights();
    expect(list).toHaveLength(1);
    expect(list[0].blurb).toBe("second");
  });

  it("caps how many can be featured", async () => {
    for (let i = 0; i < MAX_SPOTLIGHTS; i++) {
      expect(await setSpotlight(await makeSkill(`Sp${i}`), "x", i)).toBe(true);
    }
    expect(await setSpotlight(await makeSkill("Extra"), "x", 9)).toBe(false);
  });

  it("clears", async () => {
    const a = await makeSkill("Alpha");
    await setSpotlight(a, "x", 0);
    expect(await clearSpotlight(a)).toBe(true);
    expect(await clearSpotlight(a)).toBe(false);
    expect(await listSpotlights()).toEqual([]);
  });
});

describe("publishedSkillsByIds", () => {
  it("returns only published rows, deduped, and tolerates an empty ask", async () => {
    const a = await makeSkill("Alpha");
    const draft = await makeSkill("Draft", false);
    const got = await publishedSkillsByIds([a, a, draft, "skl_missing"]);
    expect([...got.keys()]).toEqual([a]);
    expect((await publishedSkillsByIds([])).size).toBe(0);
  });
});
