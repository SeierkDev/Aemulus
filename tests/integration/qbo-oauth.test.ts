import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { db } from "../../lib/db";
import { startQboStandIn, type QboStandIn } from "../helpers/qbo-stand-in";
import {
  authorizeUrl,
  newOauthState,
  qboOauthConfigured,
  exchangeCode,
  loadConnection,
  getAccessToken,
  qboConfigFromConnection,
  ensureQboConnectionSchema,
} from "../../lib/qbo/oauth";

const NOW = 1_700_000_000_000;
let qbo: QboStandIn;
const saved: Record<string, string | undefined> = {};

function setEnv(k: string, v: string) {
  saved[k] = process.env[k];
  process.env[k] = v;
}

beforeAll(async () => {
  qbo = await startQboStandIn();
  setEnv("QBO_CLIENT_ID", "client-abc");
  setEnv("QBO_CLIENT_SECRET", "secret-xyz");
  setEnv("QBO_REDIRECT_URI", "http://localhost:3000/api/qbo/callback");
  setEnv("QBO_TOKEN_URL", `${qbo.url}/oauth2/v1/tokens/bearer`);
  setEnv("QBO_BASE", qbo.url);
  await ensureQboConnectionSchema();
  await db.execute({ sql: `DELETE FROM qbo_connection WHERE id = 'default'` });
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await qbo.close();
});

describe("QBO OAuth", () => {
  it("builds an authorize URL with the config + state", () => {
    const url = new URL(authorizeUrl(newOauthState()));
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/qbo/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(qboOauthConfigured()).toBe(true);
  });

  it("has no connection before connecting", async () => {
    expect(await loadConnection()).toBeNull();
  });

  it("exchanges a code and stores an encrypted connection", async () => {
    await exchangeCode("auth-code-1", "realm-x", NOW);
    const conn = await loadConnection();
    expect(conn).toMatchObject({ realmId: "realm-x", status: "connected" });
    expect(conn?.accessToken).toMatch(/^access-\d+$/);
    expect(conn?.refreshToken).toMatch(/^refresh-\d+$/);
    // Tokens are stored encrypted, not in cleartext.
    const raw = await db.execute({ sql: `SELECT tokens_enc FROM qbo_connection WHERE id='default'` });
    expect(String(raw.rows[0].tokens_enc)).not.toContain("access-");
  });

  it("returns the stored token while it is still valid", async () => {
    const at = await getAccessToken(NOW);
    expect(at).toMatchObject({ realm: "realm-x" });
    expect(at?.token).toMatch(/^access-\d+$/);
  });

  it("refreshes the token once it has expired", async () => {
    const before = (await loadConnection())!.accessToken;
    await db.execute({ sql: `UPDATE qbo_connection SET access_expires_at = ? WHERE id='default'`, args: [NOW - 1] });
    const at = await getAccessToken(NOW);
    expect(at?.token).toMatch(/^access-\d+$/);
    expect(at?.token).not.toBe(before); // a fresh token came back
    const after = await loadConnection();
    expect(after?.accessToken).toBe(at?.token);
    expect(after!.accessExpiresAt).toBeGreaterThan(NOW); // expiry moved forward
  });

  it("produces a ready client config from the connection", async () => {
    const cfg = await qboConfigFromConnection(NOW);
    expect(cfg).toMatchObject({ base: qbo.url, realm: "realm-x" });
    expect(cfg?.token).toMatch(/^access-\d+$/);
  });
});
