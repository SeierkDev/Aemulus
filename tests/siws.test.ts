import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildSignInMessage,
  verifyWalletSignature,
  newNonce,
  createSessionToken,
  verifySessionToken,
  type Session,
} from "../lib/siws";

function signMessage(message: string) {
  const kp = nacl.sign.keyPair();
  return {
    pubkey: bs58.encode(kp.publicKey),
    signature: bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey),
    ),
  };
}

describe("SIWS signature verification", () => {
  it("verifies a genuine signature", () => {
    const msg = buildSignInMessage(newNonce());
    const { pubkey, signature } = signMessage(msg);
    expect(verifyWalletSignature(msg, signature, pubkey)).toBe(true);
  });

  it("rejects a signature over a different message", () => {
    const { pubkey, signature } = signMessage(buildSignInMessage("a"));
    expect(verifyWalletSignature(buildSignInMessage("b"), signature, pubkey)).toBe(
      false,
    );
  });

  it("rejects a signature from a different key", () => {
    const msg = buildSignInMessage(newNonce());
    const { signature } = signMessage(msg);
    const other = bs58.encode(nacl.sign.keyPair().publicKey);
    expect(verifyWalletSignature(msg, signature, other)).toBe(false);
  });

  it("rejects garbage without throwing", () => {
    expect(verifyWalletSignature("m", "not-base58!!", "nope")).toBe(false);
  });
});

describe("nonce", () => {
  it("is unique and hex-ish", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it("appears in the signed message", () => {
    const n = newNonce();
    expect(buildSignInMessage(n)).toContain(n);
  });
});

describe("session tokens", () => {
  const session: Session = {
    pubkey: "WALLET123",
    tier: "Holder",
    level: 1,
    balance: 42,
  };

  it("round-trips a valid token", async () => {
    const token = await createSessionToken(session);
    expect(await verifySessionToken(token)).toMatchObject(session);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken(session);
    expect(await verifySessionToken(token + "x")).toBeNull();
  });

  it("rejects junk", async () => {
    expect(await verifySessionToken("not.a.jwt")).toBeNull();
  });
});
