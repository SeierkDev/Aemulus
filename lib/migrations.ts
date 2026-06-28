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
];
