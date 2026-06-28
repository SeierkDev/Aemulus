import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { env } from "./env";
import { SCHEMA } from "./schema";

// For the local file fallback, libsql won't create the parent directory — do it.
function ensureLocalDir(url: string) {
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    const dir = path.dirname(path.resolve(file));
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* already exists */
    }
  }
}

/**
 * Single shared libsql client. In dev this points at a local SQLite file;
 * in production set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for the embedded
 * replica / cloud database (same approach as Axon).
 *
 * The client is cached on globalThis so Next.js hot-reload doesn't open a new
 * connection on every change.
 */

declare global {
  var __aemDb: Client | undefined;
  var __aemDbReady: Promise<void> | undefined;
}

export const db: Client =
  globalThis.__aemDb ??
  (globalThis.__aemDb = (() => {
    ensureLocalDir(env.dbUrl);
    return createClient({ url: env.dbUrl, authToken: env.dbAuthToken });
  })());

/** Idempotently create tables. Awaited by data-access code before queries. */
export function ready(): Promise<void> {
  return (globalThis.__aemDbReady ??= db.executeMultiple(SCHEMA));
}
