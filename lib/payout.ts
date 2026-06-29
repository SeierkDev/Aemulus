import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { SOLANA, gatingEnabled } from "./solana";

/**
 * On-chain creator payouts. When a treasury signer + the $AEMU mint are
 * configured, a claim transfers the creator's accrued balance from the treasury
 * wallet via an SPL token transfer. Gated exactly like receipt anchoring: with
 * no treasury key it's inactive (the UI shows "opens at launch"). Hand-rolled
 * on web3.js (no extra dependency); activate + verify with a funded treasury.
 */

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const DECIMALS = Math.max(0, Number(process.env.AEMULUS_DECIMALS) || 6);

export function payoutsEnabled(): boolean {
  return gatingEnabled() && !!process.env.AEMULUS_TREASURY_SECRET;
}

function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** Transfer `amount` (UI units) of $AEMU from treasury → wallet. Null if off. */
export async function sendPayout(
  toWallet: string,
  amount: number,
): Promise<{ sig: string; cluster: string } | null> {
  const secret = process.env.AEMULUS_TREASURY_SECRET;
  if (!gatingEnabled() || !secret) return null;

  const cluster = process.env.AEMULUS_RECEIPT_CLUSTER || "mainnet-beta";
  const rpc = process.env.AEMULUS_RECEIPT_RPC || SOLANA.rpcUrl;
  const conn = new Connection(rpc, "confirmed");
  const treasury = Keypair.fromSecretKey(bs58.decode(secret));
  const mint = new PublicKey(SOLANA.mint);
  const to = new PublicKey(toWallet);
  const src = ataFor(treasury.publicKey, mint);
  const dst = ataFor(to, mint);
  const base = BigInt(Math.floor(amount * 10 ** DECIMALS));

  const tx = new Transaction();
  // Create the recipient's token account if needed (idempotent; treasury pays).
  tx.add(
    new TransactionInstruction({
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: treasury.publicKey, isSigner: true, isWritable: true },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // createIdempotent
    }),
  );
  // SPL Transfer (instruction 3): treasury ATA → recipient ATA.
  tx.add(
    new TransactionInstruction({
      programId: TOKEN_PROGRAM,
      keys: [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: treasury.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([3]), u64le(base)]),
    }),
  );

  const sig = await sendAndConfirmTransaction(conn, tx, [treasury]);
  return { sig, cluster };
}
