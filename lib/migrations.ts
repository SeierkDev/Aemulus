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
];
