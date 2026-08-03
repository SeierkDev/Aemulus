import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { attachAgenc, attachReceipt, verifyReceipt } from "../../lib/receipt";
import type { GeneralizedSkill, Skill } from "../../lib/types";

/**
 * The constraint hash is folded into the receipt digest, which means WHEN it is
 * written matters as much as what it is. Added after a receipt exists, the
 * recomputed digest stops matching the stored one and the verify page calls a
 * run tampered with that nobody touched.
 */

let skill: Skill;

async function mkRun(id: string) {
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO runs (id, owner, skill_id, skill_version, status, input, output, created_at, updated_at)
          VALUES (?, '11111111111111111111111111111111', ?, 2, 'completed', '{}', ?, ?, ?)`,
    args: [id, skill.id, JSON.stringify({ total: "$482.00" }), now, now],
  });
}

describe("the constraint hash and the receipt", () => {
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: "11111111111111111111111111111111",
      generalized: { name: "R", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
  });

  it("verifies when the hash goes in before the receipt", async () => {
    await mkRun("run_ag_ok");
    await attachAgenc("run_ag_ok");
    await attachReceipt("run_ag_ok");

    const v = await verifyReceipt("run_ag_ok");
    expect(v.matches).toBe(true);
    expect(v.agenc?.constraintHash).toMatch(/^[0-9a-f]+$/);
  }, 30_000);

  // Every run made before this feature is in exactly this state: a receipt, and
  // no constraint hash. A backfill is the obvious thing to reach for, and
  // without the guard it would break all of them at once.
  it("refuses to add one to a run that already has a receipt", async () => {
    await mkRun("run_ag_late");
    await attachReceipt("run_ag_late"); // receipt first, as an older run would be

    const before = await verifyReceipt("run_ag_late");
    expect(before.matches).toBe(true);
    expect(before.agenc).toBeUndefined();

    await attachAgenc("run_ag_late"); // the backfill that must not land

    const after = await verifyReceipt("run_ag_late");
    // Still intact, and still honestly reporting that it has no constraint hash.
    expect(after.matches).toBe(true);
    expect(after.agenc).toBeUndefined();
  }, 30_000);
});
