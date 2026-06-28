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
import { getRun, updateReceipt } from "./runs";
import { logError, logInfo } from "./log";

/**
 * Verifiable run receipts. Each run gets a deterministic sha256 over its
 * outcome + a hash of every proof screenshot — so altering any step or image
 * changes the receipt. When a signer is configured the hash is anchored on
 * Solana via a Memo tx ("verifiable autonomy"); otherwise it's recorded locally
 * and anchoring activates at launch.
 */

const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const DATA_ROOT = path.join(process.cwd(), ".data");

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
}): string {
  const canonical = JSON.stringify({
    run: input.runId,
    skill: input.skillId,
    owner: input.owner,
    status: input.status,
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

async function hashScreenshot(rel: string): Promise<string> {
  if (!rel) return "";
  try {
    const buf = await readFile(path.join(DATA_ROOT, rel));
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return ""; // missing screenshot — still part of the (different) digest
  }
}

function explorerCluster(): string {
  return process.env.AEMULUS_RECEIPT_CLUSTER || "devnet";
}

/** Anchor a hash on Solana via Memo, if a signer is configured. */
async function maybeAnchor(
  hash: string,
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
        data: Buffer.from(`aemulus:run:${hash}`, "utf8"),
      }),
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [signer]);
    return { sig, cluster };
  } catch (e) {
    logError("receipt.anchor", e);
    return null;
  }
}

/** Compute, optionally anchor, and persist a run's receipt. */
export async function attachReceipt(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  try {
    const steps: ReceiptStep[] = await Promise.all(
      run.steps.map(async (s) => ({
        idx: s.idx,
        action: s.action,
        confidence: s.confidence,
        flagged: s.flagged,
        shotHash: await hashScreenshot(s.screenshot),
      })),
    );
    const hash = receiptDigest({
      runId: run.id,
      skillId: run.skillId,
      owner: run.owner,
      status: run.status,
      steps,
    });
    const anchored = await maybeAnchor(hash);
    await updateReceipt(runId, {
      hash,
      sig: anchored?.sig ?? null,
      cluster: anchored?.cluster ?? null,
    });
    if (anchored) logInfo("receipt.anchored", anchored.sig, { run: runId });
  } catch (e) {
    logError("receipt.attach", e, { run: runId });
  }
}

/** Solana explorer URL for an anchored receipt. */
export function explorerUrl(sig: string, cluster: string): string {
  const q = cluster && cluster !== "mainnet-beta" ? `?cluster=${cluster}` : "";
  return `https://explorer.solana.com/tx/${sig}${q}`;
}
