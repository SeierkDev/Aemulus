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
vi.mock("../../lib/payout", async (orig) => {
  const actual = await orig<typeof import("../../lib/payout")>();
  return { ...actual, findClaimPayouts: vi.fn() };
});

import { db, ready } from "../../lib/db";
import { anchorOnChain } from "../../lib/receipt";
import { recordRunOnChain } from "../../lib/registry";
import { findClaimPayouts } from "../../lib/payout";
import { getClaimable } from "../../lib/earnings";
import { createSkill } from "../../lib/skills";
import { createRun } from "../../lib/runs";
import {
  reconcileBatchAnchors,
  reconcileRegistryAnchors,
  reconcilePendingClaims,
} from "../../lib/reconcile";
import type { GeneralizedSkill } from "../../lib/types";

// Seed an earning marked claimed to a pending (sig-NULL) claim.
let seedN = 0;
async function seedPendingClaim(owner: string, amount: number, createdAt: number): Promise<string> {
  const claimId = `clm_${++seedN}`;
  await db.execute({
    sql: `INSERT INTO earnings (id, owner, skill_id, run_id, runner, amount, created_at, claim_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [`earn_${seedN}`, owner, `sk_${seedN}`, `run_${seedN}`, `rn_${seedN}`, amount, createdAt, claimId],
  });
  await db.execute({
    sql: `INSERT INTO claims (id, owner, amount, sig, cluster, created_at) VALUES (?, ?, ?, NULL, NULL, ?)`,
    args: [claimId, owner, amount, createdAt],
  });
  return claimId;
}

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
  vi.mocked(findClaimPayouts).mockReset();
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

  it("settles a pending claim whose payout IS found on-chain (records the real sig)", async () => {
    const claimId = await seedPendingClaim("CLAIM_SETTLE", 9, Date.now() - 20 * 60 * 1000);
    vi.mocked(findClaimPayouts).mockResolvedValue({
      found: { [claimId]: { sig: "PAID_SIG", cluster: "mainnet-beta" } },
      coveredSince: Date.now() - 60 * 60 * 1000,
    });
    const res = await reconcilePendingClaims();
    expect(res.settled).toBe(1);
    const c = (await db.execute({ sql: `SELECT sig FROM claims WHERE id = ?`, args: [claimId] })).rows[0];
    expect(String(c.sig)).toBe("PAID_SIG");
    // Settled → earnings stay claimed (not returned).
    expect(await getClaimable("CLAIM_SETTLE")).toBe(0);
  });

  it("rolls back a definitively-unpaid claim (old + confirmed absent) → earnings claimable again", async () => {
    const created = Date.now() - 30 * 60 * 1000; // 30m ago (past the grace window)
    const claimId = await seedPendingClaim("CLAIM_ROLLBACK", 12, created);
    vi.mocked(findClaimPayouts).mockResolvedValue({
      found: {}, // not on-chain
      coveredSince: created - 5 * 60 * 1000, // scan reached back BEFORE the claim
    });
    const res = await reconcilePendingClaims();
    expect(res.rolledBack).toBe(1);
    // Earnings returned to claimable, claim row gone.
    expect(await getClaimable("CLAIM_ROLLBACK")).toBe(12);
    expect((await db.execute({ sql: `SELECT 1 FROM claims WHERE id = ?`, args: [claimId] })).rows).toHaveLength(0);
  });

  it("leaves a recent unpaid claim pending (payout could still land)", async () => {
    const claimId = await seedPendingClaim("CLAIM_RECENT", 4, Date.now() - 60 * 1000); // 1m ago
    vi.mocked(findClaimPayouts).mockResolvedValue({ found: {}, coveredSince: Date.now() - 2 * 60 * 1000 });
    const res = await reconcilePendingClaims();
    expect(res.stuck).toBeGreaterThanOrEqual(1);
    expect(res.rolledBack).toBe(0);
    // Still claimed (not rolled back) — no double-pay window.
    expect(await getClaimable("CLAIM_RECENT")).toBe(0);
    expect((await db.execute({ sql: `SELECT sig FROM claims WHERE id = ?`, args: [claimId] })).rows[0].sig).toBeNull();
  });

  it("does NOT roll back when the scan didn't reach back before the claim (absence unconfirmed)", async () => {
    const created = Date.now() - 30 * 60 * 1000; // old enough by age…
    await seedPendingClaim("CLAIM_UNSCANNED", 8, created);
    vi.mocked(findClaimPayouts).mockResolvedValue({
      found: {},
      coveredSince: created + 5 * 60 * 1000, // …but scan only reached to AFTER it
    });
    const res = await reconcilePendingClaims();
    expect(res.rolledBack).toBe(0);
    expect(res.stuck).toBeGreaterThanOrEqual(1);
    expect(await getClaimable("CLAIM_UNSCANNED")).toBe(0); // still claimed — safe
  });
});
