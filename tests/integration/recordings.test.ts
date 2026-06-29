import { describe, expect, it, vi } from "vitest";

// The route reads the session from cookies via @/lib/auth; mock it so we can
// exercise the path-traversal / cross-wallet guard directly.
const session = { pubkey: "WALLET_A", tier: "Holder", level: 1, balance: 0 };
vi.mock("../../lib/auth", () => ({ getSession: vi.fn(async () => session) }));

import { GET } from "../../app/api/recordings/[...path]/route";

const call = (parts: string[]) =>
  GET(new Request("http://t/x"), {
    params: Promise.resolve({ path: parts }),
  });

describe("recordings IDOR / traversal guard", () => {
  it("blocks `..` traversal into another wallet's directory", async () => {
    const res = await call(["WALLET_A", "..", "WALLET_B", "x.png"]);
    expect(res.status).toBe(403);
  });

  it("blocks a path whose first segment isn't the caller", async () => {
    expect((await call(["WALLET_B", "x.png"])).status).toBe(403);
  });

  it("blocks separator-laden segments", async () => {
    expect((await call(["WALLET_A", "a/b", "x.png"])).status).toBe(403);
    expect((await call(["WALLET_A", "."])).status).toBe(403);
  });

  it("allows the caller's own path (404 only because the file is absent)", async () => {
    const res = await call(["WALLET_A", "sess_none", "0.png"]);
    expect(res.status).toBe(404);
  });
});
