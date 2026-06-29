import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, setPublished, listPublishedSkillsPage } from "../../lib/skills";
import {
  parseLimit,
  encodeCursor,
  decodeCursor,
} from "../../lib/pagination";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "P", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("pagination helpers", () => {
  it("clamps limit to [1,100] with a default", () => {
    expect(parseLimit(null)).toBe(25);
    expect(parseLimit("0")).toBe(25);
    expect(parseLimit("-5")).toBe(25);
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("9999")).toBe(100);
    expect(parseLimit("abc")).toBe(25);
  });

  it("round-trips a cursor (incl. ids containing ':')", () => {
    expect(decodeCursor(encodeCursor(123, "skl_a:b"))).toEqual({
      createdAt: 123,
      id: "skl_a:b",
    });
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-valid!!")).toBeNull();
  });
});

describe("listPublishedSkillsPage", () => {
  it("pages through all published skills with no gaps or dupes", async () => {
    const owner = "PAGE_OWNER";
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await createSkill({ owner, generalized: GEN, sourceDemoId: null });
      await setPublished(s.id, owner, true);
      ids.push(s.id);
    }

    const seen: string[] = [];
    let cursor = null as { createdAt: number; id: string } | null;
    let pages = 0;
    for (;;) {
      const page = await listPublishedSkillsPage(2, cursor);
      seen.push(...page.items.map((s) => s.id));
      pages++;
      if (!page.nextCursor) break;
      cursor = decodeCursor(page.nextCursor);
      expect(pages).toBeLessThan(20); // guard against a non-terminating loop
    }
    // every created id shows up exactly once
    for (const id of ids) expect(seen.filter((x) => x === id)).toHaveLength(1);
    expect(pages).toBeGreaterThanOrEqual(3); // 5 items @ 2/page
  });
});
