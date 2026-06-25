import { createClient, type Client } from "@libsql/client";
import { env } from "./env";
import { SCHEMA } from "./schema";

/**
 * Single shared libsql client. In dev this points at a local SQLite file;
 * in production set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for the embedded
 * replica / cloud database (same approach as Axon).
 *
 * The client is cached on globalThis so Next.js hot-reload doesn't open a new
 * connection on every change.
 */

declare global {
  var __mimicDb: Client | undefined;
  var __mimicDbReady: Promise<void> | undefined;
}

export const db: Client =
  globalThis.__mimicDb ??
  (globalThis.__mimicDb = createClient({
    url: env.dbUrl,
    authToken: env.dbAuthToken,
  }));

/** Idempotently create tables. Awaited by data-access code before queries. */
export function ready(): Promise<void> {
  return (globalThis.__mimicDbReady ??= db.executeMultiple(SCHEMA));
}
