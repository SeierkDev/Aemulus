import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { getBulkRun, listRunsByBulk, setRunOutput, getRun } from "../../lib/runs";
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

  it("persists + round-trips extracted output (encrypted at rest)", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const bulk = await createBulkRun(skill, [{ vendor: "Acme" }], OWNER);
    const [run] = await listRunsByBulk(bulk.id);

    await setRunOutput(run.id, { price: "$42.00" });
    expect((await getRun(run.id))!.output).toEqual({ price: "$42.00" });
  });
});
