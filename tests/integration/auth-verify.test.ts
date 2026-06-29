import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";

// Mock the cookie store so we can control the nonce cookie the route reads.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { cookies } from "next/headers";
import { POST } from "../../app/api/auth/verify/route";
import { buildSignInMessage, NONCE_COOKIE } from "../../lib/auth";

const DOMAIN = "test.aemulus";
const kp = nacl.sign.keyPair();
const pubkey = bs58.encode(kp.publicKey);

function setNonceCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      name === NONCE_COOKIE && value !== undefined ? { value } : undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function sign(message: string): string {
  return bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey),
  );
}

function post(body: unknown): Request {
  return new Request("http://test.aemulus/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json", host: DOMAIN },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.AEMULUS_DOMAIN = DOMAIN;
});
beforeEach(() => vi.mocked(cookies).mockReset());

describe("POST /api/auth/verify (SIWS)", () => {
  it("accepts a valid signature over the nonce-bound message and sets a session", async () => {
    const nonce = "nonce_ok";
    const issuedAt = Date.now();
    setNonceCookie(`${nonce}|${issuedAt}`);
    const msg = buildSignInMessage(nonce, DOMAIN, new Date(issuedAt).toISOString());
    const res = await POST(post({ pubkey, signature: sign(msg) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.pubkey).toBe(pubkey);
    // session cookie set, nonce cleared
    const setCookie = res.headers.getSetCookie().join(";");
    expect(setCookie).toContain("aem_session=");
  });

  it("rejects when the nonce cookie is missing (400)", async () => {
    setNonceCookie(undefined);
    const msg = buildSignInMessage("x", DOMAIN, new Date().toISOString());
    const res = await POST(post({ pubkey, signature: sign(msg) }));
    expect(res.status).toBe(400);
  });

  it("rejects an expired challenge (issued > 5 min ago, 400)", async () => {
    const nonce = "nonce_old";
    const issuedAt = Date.now() - 6 * 60 * 1000;
    setNonceCookie(`${nonce}|${issuedAt}`);
    const msg = buildSignInMessage(nonce, DOMAIN, new Date(issuedAt).toISOString());
    const res = await POST(post({ pubkey, signature: sign(msg) }));
    expect(res.status).toBe(400);
  });

  it("rejects a signature over a different message (401)", async () => {
    const nonce = "nonce_bad";
    const issuedAt = Date.now();
    setNonceCookie(`${nonce}|${issuedAt}`);
    // Sign a message with the WRONG nonce → server rebuilds the real one → mismatch.
    const wrong = buildSignInMessage("attacker", DOMAIN, new Date(issuedAt).toISOString());
    const res = await POST(post({ pubkey, signature: sign(wrong) }));
    expect(res.status).toBe(401);
  });
});
