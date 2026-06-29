import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { ataFor, u64le } from "../lib/payout";

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
