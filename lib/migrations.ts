import { SCHEMA } from "./schema";

/**
 * Versioned migrations. Each migration runs once per database (tracked in the
 * schema_migrations table) and in id order.
 *
 * - `statements` run verbatim (multi-statement strings allowed).
 * - `addColumns` use an ADD-COLUMN-IF-MISSING check, so the same migration is
 *   safe on a brand-new DB (baseline already has the column → skipped) and on
 *   an older DB (column added). This is the forward pattern for schema changes:
 *   keep the baseline (id 1) current AND append an additive migration.
 *
 * To change the schema: update SCHEMA (so fresh DBs are correct) and append a
 * new migration here (so existing DBs catch up). Never edit a shipped migration.
 */
export interface Migration {
  id: number;
  name: string;
  statements?: string[];
  addColumns?: { table: string; column: string; def: string }[];
}

export const MIGRATIONS: Migration[] = [
  // 1 — full baseline schema (CREATE TABLE/INDEX IF NOT EXISTS).
  { id: 1, name: "baseline", statements: [SCHEMA] },

  // 2 — on-chain run receipts. Baseline already carries these columns, so this
  // is a no-op on fresh DBs and backfills any DB created before receipts.
  {
    id: 2,
    name: "run_receipts",
    addColumns: [
      { table: "runs", column: "receipt_hash", def: "TEXT" },
      { table: "runs", column: "receipt_sig", def: "TEXT" },
      { table: "runs", column: "receipt_cluster", def: "TEXT" },
    ],
  },

  // 3 — Merkle-batched receipts: per-run proof columns + the batches table.
  {
    id: 3,
    name: "merkle_batches",
    addColumns: [
      { table: "runs", column: "batch_id", def: "TEXT" },
      { table: "runs", column: "leaf_index", def: "INTEGER" },
      { table: "runs", column: "merkle_proof", def: "TEXT" },
    ],
    statements: [
      `CREATE TABLE IF NOT EXISTS receipt_batches (
         id TEXT PRIMARY KEY,
         merkle_root TEXT NOT NULL,
         leaf_count INTEGER NOT NULL,
         sig TEXT,
         cluster TEXT,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_runs_unbatched ON runs(batch_id, receipt_hash);`,
    ],
  },

  // 4 — Bulk runs (run a skill across many rows) + extracted output.
  {
    id: 4,
    name: "bulk_runs",
    addColumns: [
      { table: "runs", column: "bulk_id", def: "TEXT" },
      { table: "runs", column: "row_index", def: "INTEGER" },
      { table: "runs", column: "output", def: "TEXT" },
    ],
    statements: [
      `CREATE TABLE IF NOT EXISTS bulk_runs (
         id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         skill_id TEXT NOT NULL,
         total INTEGER NOT NULL,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_runs_bulk ON runs(bulk_id);`,
    ],
  },

  // 5 — Skill versioning: version counter + a snapshot table for history/rollback.
  {
    id: 5,
    name: "skill_versions",
    addColumns: [{ table: "skills", column: "version", def: "INTEGER NOT NULL DEFAULT 1" }],
    statements: [
      `CREATE TABLE IF NOT EXISTS skill_versions (
         id TEXT PRIMARY KEY,
         skill_id TEXT NOT NULL,
         version INTEGER NOT NULL,
         name TEXT NOT NULL,
         description TEXT,
         plan TEXT NOT NULL,
         input_schema TEXT NOT NULL,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_skill_versions ON skill_versions(skill_id, version);`,
    ],
  },

  // 6 — API keys for the public /api/v1 protocol surface.
  {
    id: 6,
    name: "api_keys",
    statements: [
      `CREATE TABLE IF NOT EXISTS api_keys (
         id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         name TEXT NOT NULL,
         key_hash TEXT NOT NULL,
         prefix TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         last_used_at INTEGER,
         revoked INTEGER NOT NULL DEFAULT 0
       );`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);`,
    ],
  },

  // 7 — HMAC-signed webhooks for run events.
  {
    id: 7,
    name: "webhooks",
    statements: [
      `CREATE TABLE IF NOT EXISTS webhooks (
         id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         url TEXT NOT NULL,
         secret TEXT NOT NULL,
         active INTEGER NOT NULL DEFAULT 1,
         last_status INTEGER,
         last_at INTEGER,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks(owner);`,
    ],
  },

  // 8 — Creator payout claims: earnings.claim_id + claims table.
  {
    id: 8,
    name: "claims",
    addColumns: [{ table: "earnings", column: "claim_id", def: "TEXT" }],
    statements: [
      `CREATE TABLE IF NOT EXISTS claims (
         id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         amount REAL NOT NULL,
         sig TEXT,
         cluster TEXT,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_claims_owner ON claims(owner);`,
      `CREATE INDEX IF NOT EXISTS idx_earnings_unclaimed ON earnings(owner, claim_id);`,
    ],
  },

  // 9 — enforce unique version numbers per skill (prevents duplicate snapshots).
  {
    id: 9,
    name: "skill_version_unique",
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_versions_uniq ON skill_versions(skill_id, version);`,
    ],
  },
];
