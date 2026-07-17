import { describe, it, expect } from "vitest";
import { createApSessionToken, verifyApSessionToken } from "../../lib/ap-controls/ap-session";

const user = { userId: "usr_abc123", email: "jane@acme.co", name: "Jane", workspaceId: "usr_abc123" };

describe("AP session token", () => {
  it("round-trips a session", async () => {
    const token = await createApSessionToken(user);
    expect(await verifyApSessionToken(token)).toEqual(user);
  });

  it("rejects garbage and a tampered token", async () => {
    expect(await verifyApSessionToken("not.a.jwt")).toBeNull();
    const token = await createApSessionToken(user);
    expect(await verifyApSessionToken(token.slice(0, -3) + "xyz")).toBeNull();
  });

  it("does not accept a non-AP JWT", async () => {
    // A JWT signed with the same secret but without typ:"ap" must not authenticate.
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode((await import("../../lib/env")).env.authSecret);
    const walletish = await new SignJWT({ pubkey: "So1...", level: 3 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifyApSessionToken(walletish)).toBeNull();
  });
});
