import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { SOLANA } from "./solana";
import type { Skill } from "./types";

/**
 * On-chain registry client (the aemulus-registry Anchor program, see anchor/).
 * Records a completed run's receipt as immutable on-chain state. Gated + inert
 * exactly like Memo anchoring: with no program id + payer secret configured it
 * does nothing. Platform-operated — the payer key is the on-chain creator/runner.
 *
 * Hand-builds the two instructions (no Anchor client / IDL needed) so it matches
 * the program's account order + fixed-layout args directly.
 */

const REGISTER_DISC = anchorDisc("register_skill");
const RECORD_DISC = anchorDisc("record_receipt");
const SEND_TIMEOUT_MS = 60_000;

/** Anchor instruction discriminator: sha256("global:<name>")[0..8]. */
function anchorDisc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function sha256(...parts: string[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}
/** A 0x?hex string -> exactly 32 bytes (right-padded/truncated). */
function bytes32(hex: string | null | undefined): Buffer {
  const out = Buffer.alloc(32);
  if (hex) Buffer.from(hex.replace(/^0x/, ""), "hex").copy(out, 0, 0, 32);
  return out;
}
function outcomeCode(status: string | null): number {
  return status === "achieved" ? 1 : status === "unconfirmed" ? 2 : 0;
}

export function registryEnabled(): boolean {
  return !!process.env.AEMULUS_REGISTRY_PROGRAM && !!process.env.AEMULUS_REGISTRY_SECRET;
}

/**
 * Record a completed run on-chain (registering its skill the first time). Returns
 * the tx signature + cluster, or null if disabled / nothing to do / it fails.
 * Best-effort: callers fire-and-forget so a chain hiccup never affects the run.
 */
export async function recordRunOnChain(
  skill: Skill,
  run: { receiptHash: string | null; commitmentRoot: string | null; outcomeStatus: string | null },
): Promise<{ sig: string; cluster: string } | null> {
  if (!registryEnabled() || !run.receiptHash) return null;

  const programId = new PublicKey(process.env.AEMULUS_REGISTRY_PROGRAM!);
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.AEMULUS_REGISTRY_SECRET!));
  const cluster = process.env.AEMULUS_RECEIPT_CLUSTER || "mainnet-beta";
  const conn = new Connection(process.env.AEMULUS_RECEIPT_RPC || SOLANA.rpcUrl, "confirmed");

  const skillId = sha256(skill.id); // [u8;32]
  const metaHash = sha256(skill.name, "\0", skill.description, "\0", JSON.stringify(skill.plan));
  const receiptHash = bytes32(run.receiptHash);
  const commitmentRoot = bytes32(run.commitmentRoot);

  const [skillPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("skill"), payer.publicKey.toBuffer(), skillId],
    programId,
  );
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), skillPda.toBuffer(), receiptHash],
    programId,
  );

  // Bound the WHOLE best-effort recorder — the pre-send existence reads AND the
  // send/confirm — so a connected-but-unresponsive RPC can't pin the worker (a
  // hung getAccountInfo would otherwise never settle, since web3.js has no
  // per-request timeout and only the confirm was previously bounded).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((res) => {
    timer = setTimeout(() => res(null), SEND_TIMEOUT_MS);
  });
  const work = (async (): Promise<{ sig: string; cluster: string } | null> => {
    const ixs: TransactionInstruction[] = [];
    // register_skill once (skip if the Skill PDA already exists).
    if (!(await conn.getAccountInfo(skillPda).catch(() => null))) {
      ixs.push(
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: skillPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([REGISTER_DISC, skillId, metaHash]),
        }),
      );
    }
    // record_receipt (skip if this receipt is already on-chain — PDA is unique).
    if (!(await conn.getAccountInfo(receiptPda).catch(() => null))) {
      ixs.push(
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: skillPda, isSigner: false, isWritable: true },
            { pubkey: receiptPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([
            RECORD_DISC,
            receiptHash,
            commitmentRoot,
            Buffer.from([outcomeCode(run.outcomeStatus)]),
          ]),
        }),
      );
    }
    if (ixs.length === 0) return null; // already fully recorded
    const tx = new Transaction().add(...ixs);
    const sig = await sendAndConfirmTransaction(conn, tx, [payer]);
    return sig ? { sig, cluster } : null;
  })();
  // If the timeout wins, `work` keeps running and later rejects (blockhash
  // expiry) with nothing awaiting it — swallow that so it can't surface as an
  // unhandledRejection and crash the worker (same guard zk-receipts uses).
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
