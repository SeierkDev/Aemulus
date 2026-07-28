import { beforeAll, describe, expect, it } from "vitest";
import { ready, db } from "../../lib/db";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  authApiKey,
  apiKeyOwner,
  hasScope,
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
    expect(meta.scopes).toEqual(["read", "run"]); // default full access

    const keys = await listApiKeys(OWNER);
    expect(keys.find((k) => k.id === meta.id)).toBeTruthy();

    expect((await authApiKey(key))?.owner).toBe(OWNER);
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
    expect((await authApiKey(key))?.owner).toBe(OWNER);
    expect(await revokeApiKey(meta.id, OWNER)).toBe(true);
    expect(await authApiKey(key)).toBeNull();
    expect((await listApiKeys(OWNER)).find((k) => k.id === meta.id)).toBeUndefined();
  });

  it("won't revoke another wallet's key", async () => {
    const { key, meta } = await createApiKey(OWNER, "mine");
    expect(await revokeApiKey(meta.id, "SOMEONE_ELSE")).toBe(false);
    expect((await authApiKey(key))?.owner).toBe(OWNER); // still valid
  });

  it("revoke hard-deletes, so a create→revoke loop can't grow the table unbounded", async () => {
    const W = "WALLET_API_LOOP";
    const rowCount = async () => {
      const r = await db.execute({ sql: `SELECT COUNT(*) AS c FROM api_keys WHERE owner = ?`, args: [W] });
      return Number((r.rows[0] as Record<string, unknown>).c);
    };
    for (let i = 0; i < 10; i++) {
      const { meta } = await createApiKey(W, `loop${i}`);
      await revokeApiKey(meta.id, W);
    }
    // A soft `revoked=1` flag would have left 10 dead rows; hard-delete leaves 0.
    expect(await rowCount()).toBe(0);
  });

  it("honors scopes: read-only key can't run; 'run' implies 'read'", async () => {
    const ro = await createApiKey(OWNER, "ro", ["read"]);
    expect(ro.meta.scopes).toEqual(["read"]);
    const auth = await authApiKey(ro.key);
    expect(hasScope(auth!.scopes, "read")).toBe(true);
    expect(hasScope(auth!.scopes, "run")).toBe(false);

    // requesting only "run" still grants "read" (run implies read)
    const runOnly = await createApiKey(OWNER, "run", ["run"]);
    expect(runOnly.meta.scopes).toEqual(["read", "run"]);
    expect(hasScope(runOnly.meta.scopes, "read")).toBe(true);
  });
});
