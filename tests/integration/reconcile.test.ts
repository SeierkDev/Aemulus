import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Mock the on-chain send paths so the reconciler's DB/recovery logic is testable
// without a real Solana signer (the anchor code is exercised elsewhere).
vi.mock("../../lib/receipt", async (orig) => {
  const actual = await orig<typeof import("../../lib/receipt")>();
  return { ...actual, anchorOnChain: vi.fn() };
});
vi.mock("../../lib/registry", async (orig) => {
  const actual = await orig<typeof import("../../lib/registry")>();
  return { ...actual, recordRunOnChain: vi.fn(), registryEnabled: () => true };
});

import { db, ready } from "../../lib/db";
import { anchorOnChain } from "../../lib/receipt";
import { recordRunOnChain } from "../../lib/registry";
import { createSkill } from "../../lib/skills";
import { createRun } from "../../lib/runs";
import {
  reconcileBatchAnchors,
  reconcileRegistryAnchors,
  reconcilePendingClaims,
} from "../../lib/reconcile";
import type { GeneralizedSkill } from "../../lib/types";

const gen = (): GeneralizedSkill => ({
  name: "R",
  description: "",
  inputFields: [],
  steps: [{ intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" }],
});

async function completedRun(skillId: string, receiptHash: string): Promise<string> {
  const run = await createRun({ owner: "REC_OWNER", skillId, input: {} });
  await db.execute({
    sql: `UPDATE runs SET status = 'completed', receipt_hash = ? WHERE id = ?`,
    args: [receiptHash, run.id],
  });
  return run.id;
}

beforeAll(async () => {
  await ready();
});
afterEach(() => {
  vi.mocked(anchorOnChain).mockReset();
  vi.mocked(recordRunOnChain).mockReset();
  delete process.env.AEMULUS_RECEIPT_SECRET;
});

describe("anchor reconciliation", () => {
  it("re-anchors a sig-NULL Memo batch and backfills the batch + its runs", async () => {
    process.env.AEMULUS_RECEIPT_SECRET = "x"; // memoAnchorEnabled()
    vi.mocked(anchorOnChain).mockResolvedValue({ sig: "MEMO_SIG", cluster: "devnet" });

    const skill = await createSkill({ owner: "REC_OWNER", generalized: gen(), sourceDemoId: null });
    const r1 = await completedRun(skill.id, "h1");
    const r2 = await completedRun(skill.id, "h2");
    const batchId = "batch_rec_1";
    await db.execute({
      sql: `INSERT INTO receipt_batches (id, merkle_root, leaf_count, sig, cluster, created_at) VALUES (?, 'ROOT1', 2, NULL, NULL, ?)`,
      args: [batchId, Date.now()],
    });
    // The two runs are in the batch but their receipt_sig was left null (the
    // original anchor timed out).
    await db.execute({ sql: `UPDATE runs SET batch_id = ?, receipt_sig = NULL WHERE id IN (?, ?)`, args: [batchId, r1, r2] });

    expect(await reconcileBatchAnchors()).toBe(1);
    const b = (await db.execute({ sql: `SELECT sig FROM receipt_batches WHERE id = ?`, args: [batchId] })).rows[0];
    expect(String(b.sig)).toBe("MEMO_SIG");
    const runs = await db.execute({ sql: `SELECT receipt_sig FROM runs WHERE batch_id = ?`, args: [batchId] });
    expect(runs.rows.every((x) => String(x.receipt_sig) === "MEMO_SIG")).toBe(true);

    // Idempotent: a second pass finds nothing to do (sig no longer null).
    expect(await reconcileBatchAnchors()).toBe(0);
  });

  it("is inert when no Memo signer is configured", async () => {
    // no AEMULUS_RECEIPT_SECRET
    await db.execute({
      sql: `INSERT INTO receipt_batches (id, merkle_root, leaf_count, sig, cluster, created_at) VALUES ('batch_rec_2', 'ROOT2', 0, NULL, NULL, ?)`,
      args: [Date.now()],
    });
    expect(await reconcileBatchAnchors()).toBe(0);
    expect(vi.mocked(anchorOnChain)).not.toHaveBeenCalled();
  });

  it("re-attempts the registry anchor and backfills registry_sig", async () => {
    vi.mocked(recordRunOnChain).mockResolvedValue({ sig: "REG_SIG", cluster: "mainnet-beta" });
    const skill = await createSkill({ owner: "REC_OWNER", generalized: gen(), sourceDemoId: null });
    const runId = await completedRun(skill.id, "hreg");

    expect(await reconcileRegistryAnchors()).toBeGreaterThanOrEqual(1);
    const row = (await db.execute({ sql: `SELECT registry_sig FROM runs WHERE id = ?`, args: [runId] })).rows[0];
    expect(String(row.registry_sig)).toBe("REG_SIG");

    // Idempotent: now that registry_sig is set, the run isn't re-selected.
    vi.mocked(recordRunOnChain).mockClear();
    await reconcileRegistryAnchors();
    // (it may still process OTHER completed runs from this file, but not this one)
    const again = (await db.execute({ sql: `SELECT registry_sig FROM runs WHERE id = ?`, args: [runId] })).rows[0];
    expect(String(again.registry_sig)).toBe("REG_SIG");
  });

  it("surfaces a long-stuck pending claim (no auto-retry — double-pay risk)", async () => {
    await db.execute({
      sql: `INSERT INTO claims (id, owner, amount, sig, cluster, created_at) VALUES ('clm_stuck', 'REC_OWNER', 5, NULL, NULL, ?)`,
      args: [Date.now() - 60 * 60 * 1000], // an hour ago
    });
    expect(await reconcilePendingClaims()).toBeGreaterThanOrEqual(1);
  });
});
