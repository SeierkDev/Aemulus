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
 *
 * IMPORTANT - every statement MUST be idempotent and crash-safe. The runner is
 * NOT transactional (libsql's executeMultiple does not cooperate with an
 * explicit BEGIN/COMMIT, verified), and a migration's rows are marked applied
 * only after all its statements succeed - so a crash mid-migration re-runs the
 * whole migration. Use `CREATE ... IF NOT EXISTS`, `addColumns` (add-if-missing),
 * and idempotent `DELETE`s. NEVER a bare `INSERT` backfill or `UPDATE x = x + 1`
 * (those would double-apply on a crash+retry). If you need a non-idempotent
 * backfill, gate it so re-running is a no-op.
 */
export interface Migration {
  id: number;
  name: string;
  statements?: string[];
  addColumns?: { table: string; column: string; def: string }[];
}

export const MIGRATIONS: Migration[] = [
  // 1 - full baseline schema (CREATE TABLE/INDEX IF NOT EXISTS).
  { id: 1, name: "baseline", statements: [SCHEMA] },

  // 2 - on-chain run receipts. Baseline already carries these columns, so this
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

  // 3 - Merkle-batched receipts: per-run proof columns + the batches table.
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

  // 4 - Bulk runs (run a skill across many rows) + extracted output.
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

  // 5 - Skill versioning: version counter + a snapshot table for history/rollback.
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

  // 6 - API keys for the public /api/v1 protocol surface.
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

  // 7 - HMAC-signed webhooks for run events.
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

  // 8 - Creator payout claims: earnings.claim_id + claims table.
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

  // 9 - enforce unique version numbers per skill (prevents duplicate snapshots).
  // De-dup any pre-existing collisions FIRST so the UNIQUE index can't fail and
  // brick boot, then drop/recreate the single index as UNIQUE (no redundant
  // second index on fresh DBs).
  {
    id: 9,
    name: "skill_version_unique",
    statements: [
      `DELETE FROM skill_versions WHERE rowid NOT IN (
         SELECT MIN(rowid) FROM skill_versions GROUP BY skill_id, version
       );`,
      `DROP INDEX IF EXISTS idx_skill_versions;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_versions ON skill_versions(skill_id, version);`,
    ],
  },

  // 10 - index for the anti-Sybil "first run per (skill, runner)" earnings check.
  {
    id: 10,
    name: "earnings_skill_runner_idx",
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_earn_skill_runner ON earnings(skill_id, runner);`,
    ],
  },

  // 11 - idempotency keys for mutating POSTs (at-most-once retries).
  {
    id: 11,
    name: "idempotency_keys",
    statements: [
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
         owner TEXT NOT NULL,
         scope TEXT NOT NULL,
         key TEXT NOT NULL,
         status INTEGER,
         body TEXT,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (owner, scope, key)
       );`,
    ],
  },

  // 12 - webhook delivery visibility: attempts + last error per delivery.
  {
    id: 12,
    name: "webhook_delivery_meta",
    addColumns: [
      { table: "webhooks", column: "last_attempts", def: "INTEGER" },
      { table: "webhooks", column: "last_error", def: "TEXT" },
    ],
  },

  // 13 - API-key scopes (read | run). Existing keys default to full access.
  {
    id: 13,
    name: "api_key_scopes",
    addColumns: [
      { table: "api_keys", column: "scopes", def: "TEXT NOT NULL DEFAULT 'read,run'" },
    ],
  },

  // 14 - per-run egress allowlist on skills (existing skills stay unrestricted).
  {
    id: 14,
    name: "skill_allowed_hosts",
    addColumns: [
      { table: "skills", column: "allowed_hosts", def: "TEXT NOT NULL DEFAULT '[]'" },
    ],
  },

  // 15 - durable job queue for run execution.
  {
    id: 15,
    name: "jobs",
    statements: [
      `CREATE TABLE IF NOT EXISTS jobs (
         id TEXT PRIMARY KEY,
         run_id TEXT NOT NULL,
         runner TEXT NOT NULL,
         skill_id TEXT NOT NULL,
         input TEXT NOT NULL DEFAULT '{}',
         overrides TEXT NOT NULL DEFAULT '{}',
         status TEXT NOT NULL DEFAULT 'queued',
         attempts INTEGER NOT NULL DEFAULT 0,
         run_at INTEGER NOT NULL,
         locked_at INTEGER,
         last_error TEXT,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs(status, run_at);`,
    ],
  },

  // 16 - cost transparency: operator token usage per run.
  {
    id: 16,
    name: "run_token_usage",
    addColumns: [
      { table: "runs", column: "tokens_in", def: "INTEGER NOT NULL DEFAULT 0" },
      { table: "runs", column: "tokens_out", def: "INTEGER NOT NULL DEFAULT 0" },
    ],
  },

  // 17 - marketplace moderation: skill reports (auto-takedown).
  {
    id: 17,
    name: "skill_reports",
    statements: [
      `CREATE TABLE IF NOT EXISTS skill_reports (
         id TEXT PRIMARY KEY,
         skill_id TEXT NOT NULL,
         reporter TEXT NOT NULL,
         reason TEXT NOT NULL DEFAULT '',
         created_at INTEGER NOT NULL
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_reports_uniq ON skill_reports(skill_id, reporter);`,
    ],
  },

  // 18 - vision success-verification: did the run achieve the goal?
  {
    id: 18,
    name: "run_outcome",
    addColumns: [
      { table: "runs", column: "outcome_status", def: "TEXT" },
      { table: "runs", column: "outcome_reason", def: "TEXT" },
    ],
  },

  // 19 - inbound run triggers (event-driven runs via a signed URL).
  {
    id: 19,
    name: "triggers",
    statements: [
      `CREATE TABLE IF NOT EXISTS triggers (
         id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         skill_id TEXT NOT NULL,
         token TEXT NOT NULL,
         active INTEGER NOT NULL DEFAULT 1,
         fire_count INTEGER NOT NULL DEFAULT 0,
         last_fired_at INTEGER,
         created_at INTEGER NOT NULL
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_triggers_token ON triggers(token);`,
      `CREATE INDEX IF NOT EXISTS idx_triggers_owner ON triggers(owner);`,
    ],
  },

  // 20 - webhook event subscriptions (output destinations: run.output).
  {
    id: 20,
    name: "webhook_events",
    addColumns: [
      {
        table: "webhooks",
        column: "events",
        def: "TEXT NOT NULL DEFAULT 'run.completed,run.needs_review,run.failed'",
      },
    ],
  },

  // 21 - private verifiable receipts: per-run hiding-commitment root + salts.
  {
    id: 21,
    name: "run_commitment",
    addColumns: [
      { table: "runs", column: "commitment_root", def: "TEXT" },
      { table: "runs", column: "commitment_salts", def: "TEXT" },
    ],
  },

  // 22 - credential vault: per-host secrets auto-filled into runs.
  {
    id: 22,
    name: "vault",
    statements: [
      `CREATE TABLE IF NOT EXISTS vault (
         id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         host TEXT NOT NULL,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         created_at INTEGER NOT NULL
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_uniq ON vault(owner, host, key);`,
    ],
  },

  // 23 - teams/orgs + membership.
  {
    id: 23,
    name: "orgs",
    statements: [
      `CREATE TABLE IF NOT EXISTS orgs (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         owner TEXT NOT NULL,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner);`,
      `CREATE TABLE IF NOT EXISTS org_members (
         org_id TEXT NOT NULL,
         wallet TEXT NOT NULL,
         role TEXT NOT NULL DEFAULT 'member',
         created_at INTEGER NOT NULL,
         PRIMARY KEY (org_id, wallet)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_org_members_wallet ON org_members(wallet);`,
    ],
  },

  // 24 - skills can be shared with an org.
  {
    id: 24,
    name: "skill_org",
    addColumns: [{ table: "skills", column: "org_id", def: "TEXT" }],
  },

  // 25 - composite indexes for the hottest list/aggregate paths. `runs` is the
  // fastest-growing table: listRuns, the keyset page, and the per-run quota count
  // all filter by owner and sort/range on created_at; analytics ranges runs by
  // skill_id + created_at; the earnings page sorts an owner's ledger by date.
  {
    id: 25,
    name: "hot_path_indexes",
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_runs_owner_created ON runs(owner, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_runs_skill_created ON runs(skill_id, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_earn_owner_created ON earnings(owner, created_at);`,
    ],
  },

  // 26 - exactly-once post-run bookkeeping latch: a recovered/duplicate execution
  // of the same run (e.g. a multi-checkpoint run that outlived STALE_MS) must not
  // double-count run_count / re-fire webhooks / double metrics.
  {
    id: 26,
    name: "run_bookkept",
    addColumns: [
      { table: "runs", column: "bookkept", def: "INTEGER NOT NULL DEFAULT 0" },
    ],
  },

  // 27 - on-chain registry anchor: the tx that recorded this run's receipt via
  // the aemulus-registry program (separate from the Memo batch anchor).
  {
    id: 27,
    name: "run_registry_anchor",
    addColumns: [
      { table: "runs", column: "registry_sig", def: "TEXT" },
      { table: "runs", column: "registry_cluster", def: "TEXT" },
    ],
  },
];
