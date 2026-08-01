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

/**
 * The two SPL token programs.
 *
 * This is not a formality. $AEMU is a Token-2022 mint, and the token program is
 * part of the ATA derivation seeds — so deriving with the classic program yields
 * an address that simply does not exist, and a transfer built against the wrong
 * program is rejected. Measured against the live mint: the classic derivation
 * produced SZmQvTjf…, the real account is 3iG7eWST…. Every claim would have
 * failed. The program is therefore read from the mint at payout time rather than
 * assumed here.
 */
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Is this a token program we know how to build instructions for? */
export function isKnownTokenProgram(p: PublicKey): boolean {
  return p.equals(TOKEN_PROGRAM) || p.equals(TOKEN_2022_PROGRAM);
}
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// `Number(x) || 6` would turn an explicit AEMULUS_DECIMALS=0 into 6 (0 is falsy);
// accept 0 as a valid decimals value and only fall back to 6 for a missing/invalid one.
const DECIMALS = (() => {
  const raw = Number(process.env.AEMULUS_DECIMALS);
  return Number.isInteger(raw) && raw >= 0 ? raw : 6;
})();

/** Memo stamped on each payout so it can be matched back to its claim on-chain. */
export const CLAIM_MEMO_PREFIX = "aemulus:claim:";
function claimMemo(claimId: string): string {
  return `${CLAIM_MEMO_PREFIX}${claimId}`;
}

export function payoutsEnabled(): boolean {
  return gatingEnabled() && !!process.env.AEMULUS_TREASURY_SECRET;
}

/**
 * Derive an associated token account.
 *
 * `tokenProgram` is a seed, so passing the wrong one silently yields a valid-
 * looking address for an account that does not exist. It defaults to the classic
 * program only so existing callers keep their old behaviour; the payout path
 * always passes the program it read off the mint.
 */
export function ataFor(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];
}

export function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** UI-unit amount → base units. Round (not floor) so the on-chain amount matches
 *  the ledgered claim; amounts are whole $AEMU in practice, well within 2^53. */
export function toBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

/**
 * Build the two instructions for a treasury → wallet $AEMU transfer:
 * createIdempotent ATA (treasury pays) + TransferChecked (ix 12). Pure +
 * testable (no network/signing), so the money-critical account ordering and
 * amount encoding can be unit-tested without broadcasting.
 *
 * TransferChecked rather than the bare Transfer (ix 3) for two reasons. It is
 * accepted by both token programs, so this one path covers classic and 2022.
 * And it carries the mint and its decimals in the instruction itself, so the
 * chain rejects a transfer whose scale disagrees with the mint instead of
 * moving a thousand times the intended amount. On money, an instruction that
 * can refuse itself is worth the extra account.
 *
 * `tokenProgram` and `decimals` are required, not defaulted. Both were
 * previously assumed, and the assumption was wrong for the live mint.
 */
export function buildPayoutInstructions(
  treasury: PublicKey,
  to: PublicKey,
  mint: PublicKey,
  base: bigint,
  tokenProgram: PublicKey,
  decimals: number,
): TransactionInstruction[] {
  const src = ataFor(treasury, mint, tokenProgram);
  const dst = ataFor(to, mint, tokenProgram);
  return [
    // Create the recipient's token account if needed (idempotent; treasury pays).
    new TransactionInstruction({
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: treasury, isSigner: true, isWritable: true },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // createIdempotent
    }),
    // TransferChecked (instruction 12): src ATA → dst ATA, with the mint and its
    // decimals verified on-chain. Note the account order differs from Transfer:
    // the mint sits SECOND, between source and destination.
    new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([
        Buffer.from([12]),
        u64le(base),
        Buffer.from([decimals]),
      ]),
    }),
  ];
}

/** A failure BEFORE the transaction is broadcast (bad secret/pubkey, decimals
 *  mismatch, tx build). The caller can safely roll a claim back — nothing was sent. */
export class PayoutPrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutPrepError";
  }
}

/** Transfer `amount` (UI units) of $AEMU from treasury → wallet. Null if off.
 *  Throws PayoutPrepError for any pre-broadcast failure (rollback-safe); other
 *  throws mean the send may have happened (leave the claim pending). */
export async function sendPayout(
  toWallet: string,
  amount: number,
  reference?: string,
): Promise<{ sig: string; cluster: string } | null> {
  const secret = process.env.AEMULUS_TREASURY_SECRET;
  if (!gatingEnabled() || !secret) return null;

  const cluster = process.env.AEMULUS_RECEIPT_CLUSTER || "mainnet-beta";
  const rpc = process.env.AEMULUS_RECEIPT_RPC || SOLANA.rpcUrl;
  const conn = new Connection(rpc, "confirmed");

  let treasury: Keypair;
  let tx: Transaction;
  try {
    treasury = Keypair.fromSecretKey(bs58.decode(secret));
    const mint = new PublicKey(SOLANA.mint);
    const to = new PublicKey(toWallet);

    // Refuse to pay if the configured decimals disagree with the live mint —
    // otherwise every payout is off by orders of magnitude.
    const info = await conn.getParsedAccountInfo(mint);
    const data = info.value?.data;
    const dec =
      data && typeof data === "object" && "parsed" in data
        ? (data as { parsed?: { info?: { decimals?: number } } }).parsed?.info?.decimals
        : undefined;
    // Refuse to pay unless we can positively confirm the mint's decimals match
    // AEMULUS_DECIMALS. An unreadable mint (wrong address, RPC returned a bare/
    // unparsed account) leaves `dec` undefined — paying anyway would broadcast at
    // an UNVERIFIED scale, off by orders of magnitude. Fail closed instead.
    if (typeof dec !== "number") {
      throw new PayoutPrepError(
        "Could not read the $AEMU mint's decimals — refusing to pay to avoid a mis-payment.",
      );
    }
    if (dec !== DECIMALS) {
      throw new PayoutPrepError(
        `AEMULUS_DECIMALS=${DECIMALS} but the $AEMU mint reports ${dec} decimals — refusing to pay to avoid a mis-payment.`,
      );
    }

    // Which token program owns this mint? Read it rather than assume it: the
    // same getParsedAccountInfo call above already carries it, and assuming
    // classic SPL for a Token-2022 mint derives an account that does not exist,
    // so every payout fails. Fail closed on anything unrecognised — a mint owned
    // by some other program is not something to guess at with money.
    // Named tokenProgram, not `owner`: in a payout file `owner` reads as the
    // recipient, and this is the program that owns the MINT.
    const tokenProgram = info.value?.owner;
    if (!tokenProgram || !isKnownTokenProgram(tokenProgram)) {
      throw new PayoutPrepError(
        `The $AEMU mint is owned by ${tokenProgram?.toBase58() ?? "an unreadable program"}, which is not a known SPL token program — refusing to pay.`,
      );
    }

    tx = new Transaction();
    for (const ix of buildPayoutInstructions(
      treasury.publicKey,
      to,
      mint,
      // Amount is scaled with DECIMALS while the instruction declares `dec` from
      // the chain — the check above already proved those are equal, so there is
      // no path where the scale and the declared decimals disagree.
      toBaseUnits(amount),
      tokenProgram,
      dec,
    )) {
      tx.add(ix);
    }
    // Stamp the claim id as a Memo so a payout whose confirmation is lost can be
    // matched back to its claim on-chain (see findClaimPayouts) and safely settled
    // or rolled back — rather than stranding the creator's funds forever.
    if (reference) {
      tx.add(
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          keys: [],
          data: Buffer.from(claimMemo(reference), "utf8"),
        }),
      );
    }
  } catch (e) {
    if (e instanceof PayoutPrepError) throw e;
    throw new PayoutPrepError(e instanceof Error ? e.message : "payout preparation failed");
  }

  const sig = await sendAndConfirmTransaction(conn, tx, [treasury]);
  return { sig, cluster };
}

/**
 * Scan the treasury's recent transaction history for payout memos, mapping each
 * claim id back to the transaction that paid it. The memo is surfaced directly in
 * getSignaturesForAddress, so no per-transaction fetch is needed. Returns the
 * matches plus `coveredSince` — the oldest block time the scan reached — so the
 * caller can tell whether the ABSENCE of a claim is real (scan went back far
 * enough) or just un-scanned. Null when the treasury isn't configured.
 *
 * `_conn` is injectable for tests (defaults to a live connection).
 */
export async function findClaimPayouts(
  sinceMs: number,
  _conn?: Pick<Connection, "getSignaturesForAddress">,
): Promise<{ found: Record<string, { sig: string; cluster: string }>; coveredSince: number } | null> {
  const secret = process.env.AEMULUS_TREASURY_SECRET;
  if (!gatingEnabled() || !secret) return null;
  const cluster = process.env.AEMULUS_RECEIPT_CLUSTER || "mainnet-beta";
  const conn = _conn ?? new Connection(process.env.AEMULUS_RECEIPT_RPC || SOLANA.rpcUrl, "confirmed");
  const treasury = Keypair.fromSecretKey(bs58.decode(secret)).publicKey;

  const found: Record<string, { sig: string; cluster: string }> = {};
  let coveredSince = Date.now();
  let before: string | undefined;
  const MAX_PAGES = 10; // bound the scan (up to ~10k signatures)
  for (let page = 0; page < MAX_PAGES; page++) {
    const sigs = await conn.getSignaturesForAddress(treasury, { before, limit: 1000 });
    if (sigs.length === 0) break;
    for (const s of sigs) {
      const bt = (s.blockTime ?? 0) * 1000;
      if (bt) coveredSince = Math.min(coveredSince, bt);
      // A failed tx never moved funds — don't treat it as a settled payout.
      if (s.err) continue;
      const m = s.memo?.match(/aemulus:claim:(\S+)/);
      if (m && !found[m[1]]) found[m[1]] = { sig: s.signature, cluster };
    }
    const last = sigs[sigs.length - 1];
    before = last.signature;
    const oldestBt = (last.blockTime ?? 0) * 1000;
    if (oldestBt && oldestBt < sinceMs) break; // reached back past the window
  }
  return { found, coveredSince };
}
