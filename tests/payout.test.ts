import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ataFor, u64le, buildPayoutInstructions, toBaseUnits } from "../lib/payout";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
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

describe("buildPayoutInstructions (SPL transfer assembly - money path)", () => {
  const treasury = new PublicKey("11111111111111111111111111111111");
  const to = new PublicKey("SysvarRent111111111111111111111111111111111");
  const mint = new PublicKey("So11111111111111111111111111111111111111112");

  it("builds [createIdempotent ATA, SPL transfer] with correct programs, account order, and amount", () => {
    const base = toBaseUnits(2); // 2 $AEMU
    const [createIx, transferIx] = buildPayoutInstructions(treasury, to, mint, base);

    // 1) createIdempotent ATA on the ATA program, treasury is fee-payer + signer.
    expect(createIx.programId.toBase58()).toBe(ATA_PROGRAM);
    expect([...createIx.data]).toEqual([1]);
    expect(createIx.keys[0].pubkey.toBase58()).toBe(treasury.toBase58());
    expect(createIx.keys[0].isSigner).toBe(true);
    expect(createIx.keys[5].pubkey.toBase58()).toBe(TOKEN_PROGRAM);
    expect(createIx.keys[4].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());

    // 2) SPL Transfer (ix 3): src ATA -> dst ATA, treasury authority signs.
    expect(transferIx.programId.toBase58()).toBe(TOKEN_PROGRAM);
    expect(transferIx.keys[0].pubkey.toBase58()).toBe(ataFor(treasury, mint).toBase58());
    expect(transferIx.keys[0].isWritable).toBe(true);
    expect(transferIx.keys[1].pubkey.toBase58()).toBe(ataFor(to, mint).toBase58());
    expect(transferIx.keys[2].pubkey.toBase58()).toBe(treasury.toBase58());
    expect(transferIx.keys[2].isSigner).toBe(true);
    // data = [3, ...u64le(amount)]; amount must equal the ledgered base units.
    expect(transferIx.data[0]).toBe(3);
    expect(Buffer.from(transferIx.data.subarray(1)).readBigUInt64LE()).toBe(base);
  });

  it("toBaseUnits rounds to 6-decimal base units", () => {
    expect(toBaseUnits(1)).toBe(BigInt(1_000_000));
    expect(toBaseUnits(0)).toBe(BigInt(0));
  });
});

describe("ataFor (associated token account derivation)", () => {
  it("is deterministic for the same owner+mint", () => {
    const owner = new PublicKey("11111111111111111111111111111111");
    const mint = new PublicKey("So11111111111111111111111111111111111111112");
    const a = ataFor(owner, mint);
    const b = ataFor(owner, mint);
    expect(a.toBase58()).toBe(b.toBase58());
    // different owner → different ATA
    const other = new PublicKey("SysvarRent111111111111111111111111111111111");
    expect(ataFor(other, mint).toBase58()).not.toBe(a.toBase58());
  });
});
