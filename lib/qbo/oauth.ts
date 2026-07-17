import { randomUUID } from "node:crypto";
import { db, ready } from "../db";
import { encryptJSON, decryptJSON } from "../encrypt";
import { DEFAULT_WORKSPACE } from "../ap-controls/workspace";
import type { QboConfig } from "./client";

// QuickBooks Online OAuth2 + encrypted token storage — one connection per
// workspace (row keyed by workspace id). Authorization is interactive (the Intuit
// consent redirect), but the token exchange/refresh HTTP and the encrypted
// storage are plain functions, testable against a stand-in token endpoint via
// QBO_TOKEN_URL.

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const SCOPE = "com.intuit.quickbooks.accounting";
const REFRESH_SKEW_MS = 60_000;

const tokenUrl = () =>
  process.env.QBO_TOKEN_URL || "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function apiBase(): string {
  if (process.env.QBO_BASE) return process.env.QBO_BASE.replace(/\/+$/, "");
  return process.env.QBO_ENV === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function qboOauthConfigured(): boolean {
  return !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_REDIRECT_URI);
}

let ensured: Promise<void> | null = null;
export function ensureQboConnectionSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ready();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS qbo_connection (
          id                TEXT PRIMARY KEY,
          realm_id          TEXT NOT NULL,
          tokens_enc        TEXT NOT NULL,
          access_expires_at INTEGER NOT NULL,
          status            TEXT NOT NULL,
          connected_at      INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        )`);
    })();
  }
  return ensured;
}

export function newOauthState(): string {
  return randomUUID();
}

export function authorizeUrl(state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", process.env.QBO_CLIENT_ID ?? "");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("redirect_uri", process.env.QBO_REDIRECT_URI ?? "");
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
interface StoredTokens {
  access: string;
  refresh: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(tokenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`token endpoint returned ${r.status}`);
  const j = (await r.json()) as Partial<TokenResponse>;
  if (!j.access_token || !j.refresh_token || typeof j.expires_in !== "number") {
    throw new Error("token response missing fields");
  }
  return j as TokenResponse;
}

async function save(realmId: string, tokens: StoredTokens, expiresIn: number, now: number, workspaceId: string) {
  await ensureQboConnectionSchema();
  const accessExpiresAt = now + expiresIn * 1000;
  await db.execute({
    sql: `INSERT INTO qbo_connection (id, realm_id, tokens_enc, access_expires_at, status, connected_at, updated_at)
          VALUES (?, ?, ?, ?, 'connected', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            realm_id = excluded.realm_id,
            tokens_enc = excluded.tokens_enc,
            access_expires_at = excluded.access_expires_at,
            status = 'connected',
            updated_at = excluded.updated_at`,
    args: [workspaceId, realmId, encryptJSON(tokens), accessExpiresAt, now, now],
  });
}

export interface QboConnection {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  status: string;
}

export async function loadConnection(workspaceId: string = DEFAULT_WORKSPACE): Promise<QboConnection | null> {
  await ensureQboConnectionSchema();
  const r = await db.execute({ sql: `SELECT * FROM qbo_connection WHERE id = ?`, args: [workspaceId] });
  const row = r.rows[0];
  if (!row) return null;
  const tokens = decryptJSON<StoredTokens>(String(row.tokens_enc), { access: "", refresh: "" });
  return {
    realmId: String(row.realm_id),
    accessToken: tokens.access,
    refreshToken: tokens.refresh,
    accessExpiresAt: Number(row.access_expires_at),
    status: String(row.status),
  };
}

/** Exchange the OAuth authorization code for tokens and store the connection. */
export async function exchangeCode(code: string, realmId: string, now: number, workspaceId: string = DEFAULT_WORKSPACE): Promise<void> {
  const t = await tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: process.env.QBO_REDIRECT_URI ?? "" }),
  );
  await save(realmId, { access: t.access_token, refresh: t.refresh_token }, t.expires_in, now, workspaceId);
}

/** A valid access token (refreshing if expired), or null if not connected. */
export async function getAccessToken(now: number, workspaceId: string = DEFAULT_WORKSPACE): Promise<{ token: string; realm: string } | null> {
  const conn = await loadConnection(workspaceId);
  if (!conn || conn.status !== "connected" || !conn.accessToken) return null;
  if (now < conn.accessExpiresAt - REFRESH_SKEW_MS) {
    return { token: conn.accessToken, realm: conn.realmId };
  }
  const t = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refreshToken }));
  await save(conn.realmId, { access: t.access_token, refresh: t.refresh_token }, t.expires_in, now, workspaceId);
  return { token: t.access_token, realm: conn.realmId };
}

/** A ready-to-use client config from the stored connection, or null. */
export async function qboConfigFromConnection(now: number, workspaceId: string = DEFAULT_WORKSPACE): Promise<QboConfig | null> {
  const at = await getAccessToken(now, workspaceId);
  if (!at) return null;
  return { base: apiBase(), realm: at.realm, token: at.token };
}
