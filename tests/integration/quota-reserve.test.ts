import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createRun, type QuotaReserve } from "../../lib/runs";
import { createSkill } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

// The atomic daily-quota reserve: createRun inserts a run ONLY while the owner
// is under the limit in the window, doing the count + insert in one serialized
// SQL statement. This closes the check-then-act race a soft getQuota() leaves.

function gen(): GeneralizedSkill {
  return {
    name: "Quota",
    description: "d",
    inputFields: [],
    steps: [
      {
        intent: "open",
        action: "navigate",
        selectors: [],
        target: "data:text/html,<p>x</p>",
        valueSource: "none",
        value: "",
        inputKey: "",
        key: "",
      },
    ],
  };
}

// runs.skill_id has a FK to skills(id); seed one real skill to point runs at.
let skillId = "";
beforeAll(async () => {
  await ready();
  const s = await createSkill({ owner: "QUOTA_SKILL_OWNER", generalized: gen(), sourceDemoId: null });
  skillId = s.id;
});

const reserve = (limit: number): QuotaReserve => ({ limit, windowMs: 60_000 });

describe("atomic quota reserve", () => {
  it("caps sequential runs at the limit, then refuses (returns null)", async () => {
    const owner = "QUOTA_SEQ";
    const mk = () => createRun({ owner, skillId, input: {}, reserve: reserve(2) });
    expect(await mk()).not.toBeNull();
    expect(await mk()).not.toBeNull();
    expect(await mk()).toBeNull(); // 3rd is over the limit of 2
    expect(await mk()).toBeNull();
  });

  it("a concurrent burst can never exceed the limit", async () => {
    const owner = "QUOTA_BURST";
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createRun({ owner, skillId, input: {}, reserve: reserve(3) }),
      ),
    );
    const created = results.filter((r) => r !== null).length;
    expect(created).toBe(3); // exactly the limit, never 4+
  });

  it("unlimited (limit < 0) skips the guard and always inserts", async () => {
    const owner = "QUOTA_UNLIMITED";
    for (let i = 0; i < 4; i++) {
      expect(
        await createRun({ owner, skillId, input: {}, reserve: reserve(-1) }),
      ).not.toBeNull();
    }
  });

  it("without a reserve, createRun always inserts (unmetered paths)", async () => {
    const owner = "QUOTA_NONE";
    expect(await createRun({ owner, skillId, input: {} })).not.toBeNull();
    expect(await createRun({ owner, skillId, input: {} })).not.toBeNull();
  });
});
