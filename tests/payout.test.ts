import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ataFor,
  u64le,
  buildPayoutInstructions,
  toBaseUnits,
  isKnownTokenProgram,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../lib/payout";

const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const T2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

describe("u64le (SPL amount encoding)", () => {
  it("encodes little-endian 8-byte unsigned", () => {
    expect([...u64le(BigInt(0))]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...u64le(BigInt(1))]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect([...u64le(BigInt(256))]).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
    // 1 token at 6 decimals = 1_000_000 = 0x0F4240
    expect([...u64le(BigInt(1_000_000))]).toEqual([
      0x40, 0x42, 0x0f, 0, 0, 0, 0, 0,
    ]);
  });

  it("round-trips a large amount", () => {
    const n = BigInt("123456789000");
    expect(Buffer.from(u64le(n)).readBigUInt64LE()).toBe(n);
  });
});

/**
 * The bug this file exists to stop recurring.
 *
 * $AEMU is a Token-2022 mint. The token program is one of the ATA derivation
 * seeds, so deriving with the classic program produces a perfectly valid-looking
 * address for an account that does not exist — and every claim fails. These are
 * the real mainnet values, checked against the chain: treasury 55GgCF…, mint
 * 7QQSvS…, and the token account the chain actually holds.
 */
describe("ataFor against the live $AEMU mint", () => {
  const treasury = new PublicKey("55GgCFjjnxvhaqQsicdUGwAkUJ1KmXE5ESfWkYsFh3yg");
  const mint = new PublicKey("7QQSvSuBenaLAUuXZtmSjMbqvupSUhCsTso3f2N9pump");
  const REAL_ACCOUNT = "3iG7eWST9NUN8JSQDRd21khDUHDx7NiFL4k2e9cEVrRt";

  it("derives the account the chain actually has, using Token-2022", () => {
    expect(ataFor(treasury, mint, TOKEN_2022_PROGRAM).toBase58()).toBe(REAL_ACCOUNT);
  });

  it("derives a DIFFERENT, non-existent account with the classic program", () => {
    // An assertion rather than a comment: if these two ever collided, the test
    // above would stop proving anything.
    expect(ataFor(treasury, mint, TOKEN_PROGRAM).toBase58()).not.toBe(REAL_ACCOUNT);
  });

  it("defaults to the classic program, so the payout path must pass one", () => {
    expect(ataFor(treasury, mint).toBase58()).toBe(
      ataFor(treasury, mint, TOKEN_PROGRAM).toBase58(),
    );
  });
});

describe("isKnownTokenProgram", () => {
  it("accepts both SPL token programs", () => {
    expect(isKnownTokenProgram(TOKEN_PROGRAM)).toBe(true);
    expect(isKnownTokenProgram(TOKEN_2022_PROGRAM)).toBe(true);
  });

  // sendPayout refuses to build a transfer for anything else rather than
  // guessing at instruction layout with real money.
  it("rejects anything else", () => {
    expect(isKnownTokenProgram(SystemProgram.programId)).toBe(false);
    expect(
      isKnownTokenProgram(new PublicKey("So11111111111111111111111111111111111111112")),
    ).toBe(false);
  });
});

describe("buildPayoutInstructions (money path)", () => {
  const treasury = new PublicKey("11111111111111111111111111111111");
  const to = new PublicKey("SysvarRent111111111111111111111111111111111");
  const mint = new PublicKey("So11111111111111111111111111111111111111112");

  for (const [name, prog, expected] of [
    ["Token-2022", TOKEN_2022_PROGRAM, T2022],
    ["classic SPL", TOKEN_PROGRAM, CLASSIC],
  ] as const) {
    it(`builds [createIdempotent, TransferChecked] on ${name}`, () => {
      const base = toBaseUnits(2); // 2 $AEMU
      const [createIx, transferIx] = buildPayoutInstructions(
        treasury,
        to,
        mint,
        base,
        prog,
        6,
      );

      // 1) createIdempotent ATA on the ATA program, treasury is fee-payer +
      //    signer, and the token program is passed through so the account it
      //    creates is the one the transfer will target.
      expect(createIx.programId.toBase58()).toBe(ATA_PROGRAM);
      expect([...createIx.data]).toEqual([1]);
      expect(createIx.keys[0].pubkey.toBase58()).toBe(treasury.toBase58());
      expect(createIx.keys[0].isSigner).toBe(true);
      expect(createIx.keys[4].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
      expect(createIx.keys[5].pubkey.toBase58()).toBe(expected);

      // 2) TransferChecked (ix 12). The mint sits SECOND — a different order
      //    from the bare Transfer this replaced, and getting it wrong sends
      //    nothing.
      expect(transferIx.programId.toBase58()).toBe(expected);
      expect(transferIx.keys[0].pubkey.toBase58()).toBe(
        ataFor(treasury, mint, prog).toBase58(),
      );
      expect(transferIx.keys[0].isWritable).toBe(true);
      expect(transferIx.keys[1].pubkey.toBase58()).toBe(mint.toBase58());
      expect(transferIx.keys[1].isWritable).toBe(false);
      expect(transferIx.keys[2].pubkey.toBase58()).toBe(ataFor(to, mint, prog).toBase58());
      expect(transferIx.keys[2].isWritable).toBe(true);
      expect(transferIx.keys[3].pubkey.toBase58()).toBe(treasury.toBase58());
      expect(transferIx.keys[3].isSigner).toBe(true);

      // data = [12, ...u64le(amount), decimals]
      expect(transferIx.data[0]).toBe(12);
      expect(Buffer.from(transferIx.data.subarray(1, 9)).readBigUInt64LE()).toBe(base);
      expect(transferIx.data[9]).toBe(6);
    });
  }

  // The decimals byte is the whole point of TransferChecked: the chain rejects a
  // transfer whose scale disagrees with the mint, instead of moving 1000x.
  it("carries the decimals it was given, not a hardcoded 6", () => {
    const [, ix] = buildPayoutInstructions(
      treasury,
      to,
      mint,
      toBaseUnits(1),
      TOKEN_2022_PROGRAM,
      9,
    );
    expect(ix.data[9]).toBe(9);
  });

  it("toBaseUnits rounds to 6-decimal base units", () => {
    expect(toBaseUnits(1)).toBe(BigInt(1_000_000));
    expect(toBaseUnits(0)).toBe(BigInt(0));
  });
});
