import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  authApiKey,
  apiKeyOwner,
} from "../../lib/api-keys";

const OWNER = "WALLET_API";

beforeAll(async () => {
  await ready();
});

describe("api keys", () => {
  it("mints a usable key, lists it, and authenticates the owner", async () => {
    const { key, meta } = await createApiKey(OWNER, "ci");
    expect(key.startsWith("aem_live_")).toBe(true);
    expect(meta.prefix.endsWith("…")).toBe(true);

    const keys = await listApiKeys(OWNER);
    expect(keys.find((k) => k.id === meta.id)).toBeTruthy();

    expect(await authApiKey(key)).toBe(OWNER);
    // via a Bearer request header
    const req = new Request("http://x", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(await apiKeyOwner(req)).toBe(OWNER);
  });

  it("rejects unknown/garbage keys", async () => {
    expect(await authApiKey("aem_live_nope")).toBeNull();
    expect(await authApiKey("not-a-key")).toBeNull();
    expect(await apiKeyOwner(new Request("http://x"))).toBeNull();
  });

  it("revoked keys stop authenticating and leave the list", async () => {
    const { key, meta } = await createApiKey(OWNER, "temp");
    expect(await authApiKey(key)).toBe(OWNER);
    expect(await revokeApiKey(meta.id, OWNER)).toBe(true);
    expect(await authApiKey(key)).toBeNull();
    expect((await listApiKeys(OWNER)).find((k) => k.id === meta.id)).toBeUndefined();
  });

  it("won't revoke another wallet's key", async () => {
    const { key, meta } = await createApiKey(OWNER, "mine");
    expect(await revokeApiKey(meta.id, "SOMEONE_ELSE")).toBe(false);
    expect(await authApiKey(key)).toBe(OWNER); // still valid
  });
});
