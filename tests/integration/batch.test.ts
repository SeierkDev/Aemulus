import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createRun, finishRun, addRunStep } from "../../lib/runs";
import { attachReceipt, verifyReceipt, buildBatchBundle } from "../../lib/receipt";
import { batchPendingReceipts, recoverOrphanedBatchClaims } from "../../lib/receipt-batch";
import { verifyProof } from "../../lib/merkle";
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

  it("produces a self-contained proof bundle whose every leaf proves to the root", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    for (let i = 0; i < 3; i++) await completedRunWithReceipt(skill.id);
    const res = await batchPendingReceipts();

    const bundle = await buildBatchBundle(res!.batchId);
    expect(bundle).not.toBeNull();
    expect(bundle!.root).toBe(res!.root);
    expect(bundle!.leaves.length).toBe(res!.leafCount);
    expect(bundle!.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    // every leaf in the bundle verifies against the root, offline
    for (const leaf of bundle!.leaves) {
      expect(verifyProof(leaf.leafHash, leaf.proof, bundle!.root)).toBe(true);
    }
    // content address is deterministic
    const again = await buildBatchBundle(res!.batchId);
    expect(again!.bundleHash).toBe(bundle!.bundleHash);
  });

  it("boot recovery reclaims a STALE orphaned batch claim but NOT a live one (multi-instance)", async () => {
    const skill = await createSkill({ owner: OWNER, generalized: gen(), sourceDemoId: null });
    const id = await completedRunWithReceipt(skill.id);
    const now = 1_700_000_000_000;
    // Simulate a claimed-but-unproven run (a batch mid-anchor): batch_id set, no proof.
    await db.execute({
      sql: `UPDATE runs SET batch_id = 'b_live', batched_at = ?, merkle_proof = NULL WHERE id = ?`,
      args: [now, id],
    });
    // A peer instance booting WHILE this batch is live must NOT wipe it.
    expect(await recoverOrphanedBatchClaims(now + 1000)).toBe(0);
    const stillClaimed = await db.execute({ sql: `SELECT batch_id FROM runs WHERE id = ?`, args: [id] });
    expect(String(stillClaimed.rows[0]!.batch_id)).toBe("b_live");
    // Once genuinely stale (crashed), it IS reclaimed so it can re-batch.
    expect(await recoverOrphanedBatchClaims(now + 10 * 60_000)).toBeGreaterThanOrEqual(1);
    const released = await db.execute({ sql: `SELECT batch_id FROM runs WHERE id = ?`, args: [id] });
    expect(released.rows[0]!.batch_id).toBeNull();
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
