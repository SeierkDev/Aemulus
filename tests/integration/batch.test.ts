import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createRun, finishRun, addRunStep } from "../../lib/runs";
import { attachReceipt, verifyReceipt } from "../../lib/receipt";
import { batchPendingReceipts } from "../../lib/receipt-batch";
import type { GeneralizedSkill } from "../../lib/types";

const OWNER = "WALLET_BATCH";

function gen(): GeneralizedSkill {
  return {
    name: "Batchable",
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

async function completedRunWithReceipt(skillId: string): Promise<string> {
  const run = await createRun({ owner: OWNER, skillId, input: {} });
  await addRunStep({
    id: `rst_${run.id}`,
    runId: run.id,
    idx: 0,
    intent: "open",
    action: "navigate",
    selectorUsed: "",
    value: "",
    screenshot: "",
    confidence: 0.99,
    flagged: false,
    note: "",
    createdAt: Date.now(),
  });
  await finishRun(run.id, { status: "completed", result: "ok", error: null });
  await attachReceipt(run.id);
  return run.id;
}

beforeAll(async () => {
  await ready();
});

describe("merkle receipt batching", () => {
  it("anchors many receipts as one batch; each proves membership", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await completedRunWithReceipt(skill.id));

    const res = await batchPendingReceipts();
    expect(res).not.toBeNull();
    expect(res!.leafCount).toBe(4);
    expect(res!.anchored).toBe(false); // no signer configured in tests

    for (const id of ids) {
      const v = await verifyReceipt(id);
      expect(v.matches).toBe(true);
      expect(v.batch).toBeDefined();
      expect(v.batch!.leafCount).toBe(4);
      expect(v.batch!.root).toBe(res!.root);
      expect(v.batch!.proofValid).toBe(true); // recomputed leaf proves into root
    }

    // nothing left pending → no new batch
    expect(await batchPendingReceipts()).toBeNull();
  });

  it("tampering after batching breaks the membership proof", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const id = await completedRunWithReceipt(skill.id);
    await batchPendingReceipts();

    expect((await verifyReceipt(id)).batch!.proofValid).toBe(true);

    // alter the recorded step → recomputed leaf changes → proof fails
    await db.execute({
      sql: `UPDATE run_steps SET confidence = 0.123 WHERE run_id = ?`,
      args: [id],
    });
    const v = await verifyReceipt(id);
    expect(v.matches).toBe(false);
    expect(v.batch!.proofValid).toBe(false);
  });
});
