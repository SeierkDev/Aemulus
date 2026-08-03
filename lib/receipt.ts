import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getBatch, getRun, listBatchLeaves, updateReceipt } from "./runs";
import { arweaveUrl } from "./arweave";
import { DATA_ROOT } from "./paths";
import { OUTPUT_ARITY } from "./agenc";
import { encryptJSON } from "./encrypt";
import { shotTxs, shotUrl } from "./shot-archive";
import { verifyProof } from "./merkle";
import { logError } from "./log";
import type { Run } from "./types";

/**
 * Verifiable run receipts. Each run gets a deterministic sha256 over its
 * outcome + a hash of every proof screenshot - so altering any step or image
 * changes the receipt. When a signer is configured the hash is anchored on
 * Solana via a Memo tx ("verifiable autonomy"); otherwise it's recorded locally
 * and anchoring activates at launch.
 */

const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);


export interface ReceiptStep {
  idx: number;
  action: string;
  confidence: number;
  flagged: boolean;
  shotHash: string;
}

/** Pure, deterministic digest of a run's verifiable content. */
export function receiptDigest(input: {
  runId: string;
  skillId: string;
  owner: string;
  status: string;
  steps: ReceiptStep[];
  /** Private-receipt commitment root, folded in so it's anchored on-chain too. */
  commitmentRoot?: string | null;
  /** The outcome verdict + result/error, folded in so the "achieved" trust signal
   *  and the run's result/error are tamper-evident (not mutable DB fields the hash
   *  ignores). */
  outcomeStatus?: string | null;
  outcomeReason?: string | null;
  result?: string | null;
  error?: string | null;
  /** Canonical JSON of the isolation policy the run executed under (lib/sandbox.ts).
   *  Folded in so "this ran sandboxed, with this egress allowlist" is part of what
   *  the receipt attests, not a claim the database could be edited to make. */
  sandbox?: string | null;
  /** AgenC canonical constraint hash. Folded in so the interop number is part of
   *  what the receipt attests rather than a column the database could be edited
   *  to change. Conditional, so every receipt written before it existed keeps
   *  its canonical form. */
  agencHash?: string | null;
}): string {
  const canonical = JSON.stringify({
    run: input.runId,
    skill: input.skillId,
    owner: input.owner,
    status: input.status,
    commit: input.commitmentRoot ?? null,
    outcome: input.outcomeStatus ?? null,
    outcomeReason: input.outcomeReason ?? null,
    result: input.result ?? null,
    error: input.error ?? null,
    // Conditionally spread, NOT `?? null`: adding an always-present key would
    // change the canonical form of every receipt written before sandboxing
    // existed and invalidate their stored hashes. Absent stays absent.
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    ...(input.agencHash ? { agencHash: input.agencHash } : {}),
    steps: [...input.steps]
      .sort((a, b) => a.idx - b.idx)
      .map((s) => ({
        i: s.idx,
        a: s.action,
        c: s.confidence,
        f: s.flagged,
        h: s.shotHash,
      })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** sha256 of a stored screenshot — the hash the receipt commits to. */
export async function hashScreenshot(rel: string): Promise<string> {
  if (!rel) return "";
  try {
    const buf = await readFile(path.join(DATA_ROOT, rel));
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return ""; // missing screenshot - still part of the (different) digest
  }
}

function explorerCluster(): string {
  // Default to mainnet-beta to MATCH the registry + zk anchor paths. With the old
  // "devnet" default, an operator who configured a signer but left
  // AEMULUS_RECEIPT_CLUSTER unset would anchor the Memo batch to devnet while the
  // registry/zk receipts went to mainnet — the same run's proofs split across two
  // chains, and explorer links pointing at the wrong one.
  return process.env.AEMULUS_RECEIPT_CLUSTER || "mainnet-beta";
}

/**
 * Anchor an arbitrary memo on Solana, if a signer is configured. Used to commit
 * a Merkle batch root in a single transaction (one tx for thousands of runs).
 */
export async function anchorOnChain(
  memo: string,
): Promise<{ sig: string; cluster: string } | null> {
  const secret = process.env.AEMULUS_RECEIPT_SECRET;
  if (!secret) return null;
  try {
    const signer = Keypair.fromSecretKey(bs58.decode(secret));
    const cluster = explorerCluster();
    const rpc = process.env.AEMULUS_RECEIPT_RPC || clusterApiUrl(cluster as never);
    const conn = new Connection(rpc, "confirmed");
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM,
        data: Buffer.from(memo, "utf8"),
      }),
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [signer]);
    return { sig, cluster };
  } catch (e) {
    logError("receipt.anchor", e);
    return null;
  }
}

/** Recompute the digest from a run's current stored data + screenshots. */
async function digestForRun(run: Run): Promise<string> {
  const steps: ReceiptStep[] = await Promise.all(
    run.steps.map(async (s) => ({
      idx: s.idx,
      action: s.action,
      confidence: s.confidence,
      flagged: s.flagged,
      shotHash: await hashScreenshot(s.screenshot),
    })),
  );
  return receiptDigest({
    runId: run.id,
    skillId: run.skillId,
    owner: run.owner,
    status: run.status,
    commitmentRoot: run.commitmentRoot,
    outcomeStatus: run.outcomeStatus,
    outcomeReason: run.outcomeReason,
    result: run.result,
    error: run.error,
    sandbox: run.sandbox,
    agencHash: run.agencHash,
    steps,
  });
}

/** Compute, optionally anchor, and persist a run's receipt. */
/**
 * Compute and store this run's AgenC constraint hash, before the receipt is
 * hashed so the number is inside it.
 *
 * Best effort by design: a missing constraint hash costs an interop field, an
 * exception here would cost the receipt itself.
 */
export async function attachAgenc(runId: string): Promise<void> {
  try {
    const run = await getRun(runId);
    if (!run || run.agencHash) return; // already done, or nothing to do
    // Never after the receipt is written. The digest folds the constraint hash
    // in, so adding one to a run that already has a receipt would make the
    // recomputed digest disagree with the stored one — and the verify page would
    // report "Receipt mismatch" on a run nobody touched. Every run that predates
    // this feature is in exactly that state, so a well-meaning backfill would
    // break all of them at once.
    if (run.receiptHash) return;
    const { commitRun } = await import("./agenc");
    const c = await commitRun({
      id: run.id,
      owner: run.owner,
      skillId: run.skillId,
      skillVersion: run.skillVersion,
      status: run.status,
      outcomeStatus: run.outcomeStatus,
      outputs: run.output,
    });
    if (!c) return;
    const { db, ready } = await import("./db");
    await ready();
    await db.execute({
      sql: `UPDATE runs SET agenc_hash = ?, agenc_commitment = ?, agenc_salt = ? WHERE id = ?`,
      args: [
        c.constraintHash,
        c.outputCommitment,
        // NULL rather than an encrypted blob wrapping null, so "has a salt" is
        // answerable in SQL without decrypting every row to find out it doesn't.
        c.salt ? encryptJSON({ salt: c.salt }) : null,
        runId,
      ],
    });
  } catch (e) {
    logError("agenc.attach", e, { run: runId });
  }
}

export async function attachReceipt(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  try {
    // Compute + store the leaf hash only. Anchoring happens later, in a Merkle
    // batch, so thousands of runs commit in a single transaction.
    const hash = await digestForRun(run);
    await updateReceipt(runId, { hash, sig: null, cluster: null });
  } catch (e) {
    logError("receipt.attach", e, { run: runId });
  }
}

export interface BatchBundle {
  batchId: string;
  root: string;
  sig: string | null;
  cluster: string | null;
  leafCount: number;
  createdAt: number;
  /** sha256 over {root, leaves} - content address; pin this anywhere. */
  bundleHash: string;
  leaves: {
    runId: string;
    leafHash: string;
    leafIndex: number;
    proof: { siblings: { hash: string; left: boolean }[] };
  }[];
}

/**
 * The form written to permanent storage: everything except the Merkle proofs.
 *
 * Not a lossy shortcut — this is exactly the canonical form bundleHash is
 * already computed over. Every proof is derivable from the ordered leaf hashes,
 * so carrying them is O(n log n) of redundancy on top of O(n) of information.
 * At the batcher's 1000-leaf cap that redundancy is the difference between
 * roughly 1 MB and 79 KB, which is the difference between a batch that can be
 * stored permanently and one that silently never is.
 *
 * Run ids are dropped with the proofs. A verifier holding a receipt recomputes
 * its hash and finds it among the leaves; nobody else learns which runs are in
 * here, which is the right trade for a copy that is public forever.
 */
export interface ArchiveBundle {
  batchId: string;
  root: string;
  sig: string | null;
  cluster: string | null;
  leafCount: number;
  createdAt: number;
  bundleHash: string;
  leaves: { i: number; h: string }[];
}

export function toArchiveBundle(b: BatchBundle): ArchiveBundle {
  return {
    batchId: b.batchId,
    root: b.root,
    sig: b.sig,
    cluster: b.cluster,
    leafCount: b.leafCount,
    createdAt: b.createdAt,
    bundleHash: b.bundleHash,
    leaves: b.leaves.map((l) => ({ i: l.leafIndex, h: l.leafHash })),
  };
}

/**
 * A self-contained, content-addressed proof bundle for a batch: the root, the
 * (optional) on-chain signature, and every leaf's hash + Merkle proof. It's
 * verifiable offline (recompute the root from each leaf+proof) and app-
 * independent - pin it to Arweave/IPFS and the receipts outlive this service.
 */
export async function buildBatchBundle(
  batchId: string,
): Promise<BatchBundle | null> {
  const batch = await getBatch(batchId);
  if (!batch) return null;
  const leaves = await listBatchLeaves(batchId);
  const canonical = JSON.stringify({
    root: batch.merkleRoot,
    leaves: leaves.map((l) => ({ i: l.leafIndex, h: l.leafHash })),
  });
  const bundleHash = createHash("sha256").update(canonical).digest("hex");
  return {
    batchId: batch.id,
    root: batch.merkleRoot,
    sig: batch.sig,
    cluster: batch.cluster,
    leafCount: batch.leafCount,
    createdAt: batch.createdAt,
    bundleHash,
    leaves,
  };
}

/** Solana explorer URL for an anchored receipt. */
export function explorerUrl(sig: string, cluster: string): string {
  const q = cluster && cluster !== "mainnet-beta" ? `?cluster=${cluster}` : "";
  return `https://explorer.solana.com/tx/${sig}${q}`;
}

export interface ReceiptVerification {
  found: boolean;
  runId: string;
  status?: string;
  steps?: number;
  hash?: string | null;
  /** Recomputed digest equals the recorded receipt (tamper-evident). */
  matches?: boolean;
  /**
   * Steps whose screenshot the receipt commits to but that is no longer on
   * disk. A mismatch caused by this is evidence that went missing, NOT evidence
   * that was edited, and telling a user their run "changed since it ran" when a
   * file simply isn't there accuses them of tampering over an infrastructure
   * problem.
   */
  missingShots?: number;
  /** Private-receipt commitment root (selective disclosure; reveals nothing). */
  commitmentRoot?: string | null;
  /** On-chain registry record (aemulus-registry program), if anchored. */
  registry?: { sig: string; cluster: string; url: string };
  /**
   * AgenC interop: a public commitment to a private result.
   *
   * The hash is canonical, so whoever HOLDS the run data can rebuild the vector
   * and recompute it with AgenC's own SDK. A stranger cannot, because one of the
   * four elements is a digest of the outputs and those are not public — and must
   * not be, since a digest of a low-entropy value like a price is guessable by
   * brute force. So this proves a result was fixed at run time to anyone the
   * owner chooses to show it to, and tells everyone else nothing.
   */
  agenc?: { constraintHash: string; commitment: string | null; arity: number };
  /**
   * Permanently stored screenshots, present only when the owner explicitly
   * published them. Public verification has never returned screenshots and
   * still doesn't — this returns a link to a copy the owner chose to make
   * public, and nothing at all for every other run.
   */
  shots?: { hash: string; url: string }[];
  /** ZK-compressed receipt (aemulus-zk-receipts Light program), if anchored. */
  zk?: { sig: string; address: string; cluster: string; url: string };
  /** Merkle batch this run was anchored in, if batched. */
  batch?: {
    id: string;
    root: string;
    index: number;
    leafCount: number;
    /**
     * Where this batch's proof bundle is stored permanently, readable by
     * anyone with no account and no help from us. Written but never shown is
     * the same as not stored at all — if the id only ever lived in our
     * database, the proof would stop being findable the moment we did.
     */
    arweave?: { id: string; url: string };
    /** Recomputed leaf proves into the batch root (membership). */
    proofValid: boolean;
    anchor?: {
      sig: string;
      cluster: string;
      url: string;
      /** true/false from on-chain read, or null if the chain was unreachable. */
      memoMatches: boolean | null;
    };
  };
}

/** Read the anchored Memo back from chain and confirm it carries the hash. */
async function checkOnChainMemo(
  sig: string,
  cluster: string,
  hash: string,
): Promise<boolean | null> {
  try {
    const rpc =
      process.env.AEMULUS_RECEIPT_RPC || clusterApiUrl(cluster as never);
    const conn = new Connection(rpc, "confirmed");
    // Bound the RPC round-trip - this runs in the public verify page's render
    // path; a slow/unreachable RPC must degrade to "unknown" (null), not hang.
    const tx = await Promise.race([
      conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!tx) return null;
    const logs = tx.meta?.logMessages ?? [];
    return logs.some((l) => l.includes(hash));
  } catch (e) {
    logError("receipt.readback", e);
    return null;
  }
}

/**
 * Public verification: recompute the digest from stored data and compare to the
 * recorded receipt, and (if anchored) confirm the on-chain memo carries it.
 * Returns only non-sensitive fields - never inputs or screenshots.
 */
export async function verifyReceipt(
  runId: string,
): Promise<ReceiptVerification> {
  const run = await getRun(runId);
  if (!run || !run.receiptHash) return { found: false, runId };
  const recomputed = await digestForRun(run);
  const verification: ReceiptVerification = {
    found: true,
    runId,
    status: run.status,
    steps: run.steps.length,
    hash: run.receiptHash,
    matches: recomputed === run.receiptHash,
    commitmentRoot: run.commitmentRoot,
  };

  if (run.registrySig && run.registryCluster) {
    verification.registry = {
      sig: run.registrySig,
      cluster: run.registryCluster,
      url: explorerUrl(run.registrySig, run.registryCluster),
    };
  }

  if (run.zkSig && run.zkCluster) {
    verification.zk = {
      sig: run.zkSig,
      address: run.zkAddress ?? "",
      cluster: run.zkCluster,
      url: explorerUrl(run.zkSig, run.zkCluster),
    };
  }

  if (run.batchId && run.merkleProof) {
    const batch = await getBatch(run.batchId);
    if (batch) {
      // Prove the RECOMPUTED leaf into the on-chain root: ties data integrity
      // and membership into one check (tampered data → leaf changes → fails).
      const proofValid = verifyProof(
        recomputed,
        run.merkleProof,
        batch.merkleRoot,
      );
      verification.batch = {
        id: batch.id,
        root: batch.merkleRoot,
        index: run.leafIndex ?? -1,
        leafCount: batch.leafCount,
        proofValid,
      };
      if (batch.arweaveId) {
        verification.batch.arweave = {
          id: batch.arweaveId,
          url: arweaveUrl(batch.arweaveId),
        };
      }
      if (batch.sig && batch.cluster) {
        verification.batch.anchor = {
          sig: batch.sig,
          cluster: batch.cluster,
          url: explorerUrl(batch.sig, batch.cluster),
          memoMatches: await checkOnChainMemo(
            batch.sig,
            batch.cluster,
            batch.merkleRoot,
          ),
        };
      }
    }
  }

  if (run.agencHash) {
    verification.agenc = {
      constraintHash: run.agencHash,
      commitment: run.agencCommitment,
      arity: OUTPUT_ARITY,
    };
  }

  // Only for a run whose owner explicitly published it. Everything else returns
  // no screenshot information at all, exactly as before.
  // Only worth computing when something already failed — this is the difference
  // between "we cannot check this" and "this was altered".
  if (verification.matches === false) {
    let missing = 0;
    for (const st of run.steps) {
      if (!st.screenshot) continue; // no screenshot recorded (e.g. a sensitive step)
      if (!(await hashScreenshot(st.screenshot))) missing++;
    }
    if (missing) verification.missingShots = missing;
  }

  if (run.shotsPublic) {
    const hashes = await Promise.all(run.steps.map((s) => hashScreenshot(s.screenshot)));
    // One query for the whole run: this is an open endpoint, and a query per
    // screenshot would make every public verification fan out with step count.
    const txs = await shotTxs(hashes);
    const shots = hashes
      .filter((h) => h && txs.has(h))
      .map((h) => ({ hash: h, url: shotUrl(txs.get(h)!) }));
    if (shots.length) verification.shots = shots;
  }
  return verification;
}
