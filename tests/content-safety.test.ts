import { describe, it, expect } from "vitest";
import { blocklistHit, checkText, checkValues } from "../lib/content-safety";

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
