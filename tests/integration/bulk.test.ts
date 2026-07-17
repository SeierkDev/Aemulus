import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { getBulkRun, listRunsByBulk, setRunOutput, getRun, addRunStep } from "../../lib/runs";
import { createSkill } from "../../lib/skills";
import { createBulkRun } from "../../lib/bulk";
import type { GeneralizedSkill } from "../../lib/types";

const OWNER = "WALLET_BULK";

function gen(): GeneralizedSkill {
  return {
    name: "Bulk skill",
    description: "d",
    inputFields: [{ key: "vendor", label: "Vendor", example: "Acme" }],
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

beforeAll(async () => {
  await ready();
});

describe("bulk runs", () => {
  it("creates a parent + one child run per row, tagged with row index", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const rows = [{ vendor: "Acme" }, { vendor: "Beta" }, { vendor: "Gamma" }];
    const bulk = await createBulkRun(skill, rows, OWNER);

    expect((await getBulkRun(bulk.id))!.total).toBe(3);

    const children = await listRunsByBulk(bulk.id);
    expect(children).toHaveLength(3);
    expect(children.map((r) => r.rowIndex)).toEqual([0, 1, 2]);
    expect(children.map((r) => r.input.vendor)).toEqual(["Acme", "Beta", "Gamma"]);
    expect(children.every((r) => r.bulkId === bulk.id)).toBe(true);
  });

  it("groups each child's steps to the right run (batched fetch, no cross-talk)", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const bulk = await createBulkRun(skill, [{ vendor: "A" }, { vendor: "B" }], OWNER);
    const children = await listRunsByBulk(bulk.id);
    const step = (runId: string, idx: number, intent: string) =>
      addRunStep({
        id: `st_${runId}_${idx}`,
        runId,
        idx,
        intent,
        action: "click",
        selectorUsed: "",
        value: "",
        screenshot: "",
        confidence: 1,
        flagged: false,
        note: "",
        createdAt: Date.now(),
      });
    // child 0 gets two steps, child 1 gets one — must not bleed across runs.
    await step(children[0].id, 0, "c0-a");
    await step(children[0].id, 1, "c0-b");
    await step(children[1].id, 0, "c1-a");

    const after = await listRunsByBulk(bulk.id);
    expect(after[0].steps.map((s) => s.intent)).toEqual(["c0-a", "c0-b"]);
    expect(after[1].steps.map((s) => s.intent)).toEqual(["c1-a"]);
  });

  it("persists + round-trips extracted output (encrypted at rest)", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const bulk = await createBulkRun(skill, [{ vendor: "Acme" }], OWNER);
    const [run] = await listRunsByBulk(bulk.id);

    await setRunOutput(run.id, { price: "$42.00" });
    expect((await getRun(run.id))!.output).toEqual({ price: "$42.00" });
  });

  it("applies the atomic quota reserve per child and reports skipped rows", async () => {
    const owner = "WALLET_BULK_QUOTA";
    const skill = await createSkill({ owner, generalized: gen(), sourceDemoId: null });
    // limit 2 → of 5 rows, exactly 2 start and 3 are skipped (not silently dropped).
    const bulk = await createBulkRun(
      skill,
      [{ vendor: "a" }, { vendor: "b" }, { vendor: "c" }, { vendor: "d" }, { vendor: "e" }],
      owner,
      { limit: 2, windowMs: 60_000 },
    );
    expect(bulk.total).toBe(2);
    expect(bulk.skipped).toBe(3);
    expect(await listRunsByBulk(bulk.id)).toHaveLength(2);
  });
});
