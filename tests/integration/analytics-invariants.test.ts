import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { getSkillAnalytics } from "../../lib/analytics";
import type { GeneralizedSkill, Skill } from "../../lib/types";

/**
 * The panel puts these numbers next to each other on one screen, so they have to
 * agree. A card that sums to something different from the tile above it reads as
 * a broken product even when every individual query is correct.
 */

let skill: Skill;
const now = Date.now();

async function mkRun(id: string, status: string, owner: string, version: number | null, steps: string[]) {
  await db.execute({
    sql: `INSERT INTO runs (id, owner, skill_id, skill_version, status, input, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
    args: [id, owner, skill.id, version, status, now, now],
  });
  for (const [i, intent] of steps.entries()) {
    await db.execute({
      sql: `INSERT INTO run_steps (id, run_id, idx, intent, action, screenshot, confidence, flagged, note, created_at)
            VALUES (?, ?, ?, ?, 'click', '', 1, 0, '', ?)`,
      args: [`${id}_s${i}`, id, i, intent, now],
    });
  }
}

describe("the numbers on screen agree with each other", () => {
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: "inv_owner",
      generalized: { name: "I", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
    await mkRun("inv_1", "completed", "a", 1, ["open", "read"]);
    await mkRun("inv_2", "completed", "a", 2, ["open", "read"]);
    await mkRun("inv_3", "failed", "b", 2, ["open"]);
    await mkRun("inv_4", "needs_review", "c", 2, ["open", "read", "confirm"]);
    await mkRun("inv_5", "failed", "d", null, []); // died before any step
    await mkRun("inv_6", "running", "e", 2, []); // no verdict yet
  });

  it("every settled run appears in exactly one version bucket", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    const summed = a.byVersion.reduce((n, v) => n + v.runs, 0);
    expect(summed).toBe(a.runs);
    // and the in-flight one is in none of them
    expect(summed).toBe(5);
  });

  it("succeeded, failed and needing review account for every settled run", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    expect(a.succeeded + a.failed + a.needsReview).toBe(a.runs);
  });

  it("the daily series totals the same as the headline count", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    const fromSeries = a.series.reduce((n, d) => n + d.ok + d.failed + d.needsReview, 0);
    expect(fromSeries).toBe(a.runs);
  });

  // Every run that did not complete stopped somewhere, and the top-5 cut means
  // the list can be shorter but never larger than the thing it describes.
  it("never claims more stops than there were unfinished runs", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    const stopped = a.stops.reduce((n, s) => n + s.stops, 0);
    expect(stopped).toBeLessThanOrEqual(a.failed + a.needsReview);
  });

  it("counts each version's successes within its own runs", async () => {
    const a = await getSkillAnalytics(skill.id, 30);
    for (const v of a.byVersion) {
      expect(v.succeeded).toBeLessThanOrEqual(v.runs);
      if (v.rate !== null) {
        expect(v.rate).toBeGreaterThanOrEqual(0);
        expect(v.rate).toBeLessThanOrEqual(1);
      }
    }
  });
});
