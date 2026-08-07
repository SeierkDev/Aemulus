import { describe, it, expect } from "vitest";
import { blocklistHit, checkText, checkValues, stripIdentifiers } from "../lib/content-safety";

describe("content safety blocklist", () => {
  it("ALLOWS ordinary profanity", () => {
    expect(blocklistHit("fuck this stupid form")).toBe(false);
    expect(blocklistHit("what the hell, damn it")).toBe(false);
  });

  it("does not trip on innocent substrings", () => {
    expect(blocklistHit("Scunthorpe United fixtures")).toBe(false);
    expect(blocklistHit("classic literature analysis")).toBe(false);
  });

  it("blocks hate slurs, including simple obfuscation", () => {
    // separators/leet are folded, so evasions still match
    expect(blocklistHit("k.i.k.e")).toBe(true);
    expect(blocklistHit("n1gger")).toBe(true);
  });

  it("blocks illegal-abuse markers", () => {
    expect(blocklistHit("child porn")).toBe(true);
  });
});

describe("checkText / checkValues (blocklist path, AI off)", () => {
  it("allows normal + profane text, blocks hate", async () => {
    expect((await checkText("book a flight to Tokyo")).allowed).toBe(true);
    expect((await checkText("this fucking site")).allowed).toBe(true);
    expect((await checkText("k i k e")).allowed).toBe(false);
  });

  it("moderates the joined values of a run input map", async () => {
    expect((await checkValues({ q: "best pizza in NYC" })).allowed).toBe(true);
    expect((await checkValues({ q: "n1gger" })).allowed).toBe(false);
  });

  it("empty input is allowed", async () => {
    expect((await checkText("")).allowed).toBe(true);
    expect((await checkValues({})).allowed).toBe(true);
  });
});

describe("run inputs are not prose", () => {
  // Measured, not hypothetical: these are ordinary base58 Solana addresses that
  // happen to contain a blocklist term. Before identifiers were stripped, a user
  // pasting a wallet address was told their input was hate speech and the run
  // was refused with a 400.
  const ADDRESSES = [
    "7xKiKeQ9mVn2pFhT4LqRs8YbNc3WdEuZgJ1oPvXaHmT2",
    "9aChinKz4WpQm7RtY2bVnEs6XcLd8FgHj3KoPuZvA1Nq",
    "So11111111111111111111111111111111111111112",
  ];

  it("flags them before stripping — this is the bug", () => {
    expect(blocklistHit(ADDRESSES[0])).toBe(true);
    expect(blocklistHit(ADDRESSES[1])).toBe(true);
  });

  it("lets a wallet address through as a run input", async () => {
    for (const a of ADDRESSES) {
      const r = await checkValues({ wallet: a });
      expect(r.allowed).toBe(true);
    }
  });

  it("strips a transaction signature, not just an address", () => {
    // ~88 base58 chars, twice the length of an address and twice the chance of
    // containing a flagged sequence. A 64-char ceiling let these through.
    // 88 chars, all from the real base58 alphabet (no 0/O/I/l).
    const sig =
      "o93dmW2Cb9DuD7NjDy98XmjyLt7npp47amgEMCA6KiKeZ8VpBLNzx78u1UnxN79PodNcnGYhAXfveAW92SaXAFqW";
    expect(blocklistHit(sig)).toBe(true);
    expect(stripIdentifiers(sig).trim()).toBe("");
    expect(stripIdentifiers(`https://solscan.io/tx/${sig}`).includes(sig)).toBe(false);
  });

  it("strips 0x addresses and long hashes too", () => {
    // Hex is 0-9a-f, so an 0x address can never contain these terms in the
    // first place — it is stripped for consistency, not because it was at risk.
    expect(stripIdentifiers("0x7c3aF9e21bD4405e8CbA0f19d2E7f8B1a64C0D93").trim()).toBe("");
    expect(stripIdentifiers("a".repeat(40)).trim()).toBe("");
  });

  it("leaves ordinary words alone", () => {
    expect(stripIdentifiers("check the whale balance")).toBe("check the whale balance");
    expect(stripIdentifiers("invoice 4471 for Acme")).toBe("invoice 4471 for Acme");
  });

  it("still blocks a slur typed as words in a run input", async () => {
    // Stripping identifiers must not become a hole: real prose is untouched.
    const r = await checkValues({ q: "you are a faggot" });
    expect(r.allowed).toBe(false);
  });

  it("does NOT strip identifiers from published names and descriptions", async () => {
    // checkText is what publishing uses, and those strings are read by other
    // people — the trade runs the other way there.
    const r = await checkText("7xKiKeQ9mVn2pFhT4LqRs8YbNc3WdEuZgJ1oPvXaHmT2");
    expect(r.allowed).toBe(false);
  });
});
