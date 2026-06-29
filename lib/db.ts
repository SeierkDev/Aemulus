import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { env } from "./env";
import { MIGRATIONS } from "./migrations";

// For the local file fallback, libsql won't create the parent directory - do it.
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

/** ALTER ... ADD COLUMN, but only if the column isn't already present. */
export async function addColumnIfMissing(
  table: string,
  column: string,
  def: string,
): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  const exists = info.rows.some((r) => String(r.name) === column);
  if (!exists) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

/** Apply pending migrations in id order; each runs once per database. */
export async function migrate(): Promise<void> {
  await db.executeMultiple(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );`,
  );
  const r = await db.execute(`SELECT id FROM schema_migrations`);
  const applied = new Set(r.rows.map((row) => Number(row.id)));

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    // Columns first, then statements - so an index/table in the same migration
    // can safely reference a column this migration adds.
    for (const c of m.addColumns ?? []) {
      await addColumnIfMissing(c.table, c.column, c.def);
    }
    for (const sql of m.statements ?? []) await db.executeMultiple(sql);
    await db.execute({
      sql: `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`,
      args: [m.id, m.name, Date.now()],
    });
  }
}

/** Idempotently bring the schema up to date. Awaited before any query. */
export function ready(): Promise<void> {
  return (globalThis.__aemDbReady ??= migrate());
}
