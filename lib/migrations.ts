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

  // 28 - ZK-compressed receipt anchor: the tx + derived compressed-account
  // address that recorded this run's receipt via the aemulus-zk-receipts Light
  // program (cheap, ZK-validity-proven; separate from the rent-bearing registry).
  {
    id: 28,
    name: "run_zk_anchor",
    addColumns: [
      { table: "runs", column: "zk_sig", def: "TEXT" },
      { table: "runs", column: "zk_address", def: "TEXT" },
      { table: "runs", column: "zk_cluster", def: "TEXT" },
    ],
  },

  // 29 - encrypt trigger tokens at rest. `token` now holds the sha256 hash (the
  // lookup key); `token_enc` holds the encrypted plaintext for re-display. The
  // raw token is no longer stored. Any legacy row still holding a plaintext
  // token (token_enc IS NULL) can't be re-hashed/encrypted here (the key lives
  // in Node, not SQL) and would no longer resolve, so drop it - the owner simply
  // recreates the trigger. addColumns runs before statements, so token_enc
  // exists when the DELETE references it. Both steps are idempotent.
  {
    id: 29,
    name: "trigger_token_encrypted",
    addColumns: [{ table: "triggers", column: "token_enc", def: "TEXT" }],
    statements: [`DELETE FROM triggers WHERE token_enc IS NULL;`],
  },

  // 30 - server-side single-use SIWS nonces (baseline already carries the table,
  // so this is a no-op on fresh DBs and creates it on older ones).
  {
    id: 30,
    name: "auth_nonces",
    statements: [
      `CREATE TABLE IF NOT EXISTS auth_nonces (nonce TEXT PRIMARY KEY, issued_at INTEGER NOT NULL);`,
    ],
  },

  // 31 - enforce the earnings exactly-once invariant in the DB (one credit per
  // (skill_id, runner)) instead of relying solely on writer serialization. Drop
  // any pre-existing duplicate (keep the earliest) so the unique index can build.
  // Both statements are idempotent: with no dups the DELETE is a no-op and the
  // index is IF NOT EXISTS.
  {
    id: 31,
    name: "earnings_unique_skill_runner",
    statements: [
      `DELETE FROM earnings WHERE rowid NOT IN (SELECT MIN(rowid) FROM earnings GROUP BY skill_id, runner);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_earn_skill_runner_uniq ON earnings(skill_id, runner);`,
    ],
  },

  // 32 - webhook consecutive-failure counter (auto-disable dead/hostile sinks).
  // Baseline carries it, so this is a no-op on fresh DBs and adds it on older ones.
  {
    id: 32,
    name: "webhook_fail_streak",
    addColumns: [
      { table: "webhooks", column: "fail_streak", def: "INTEGER NOT NULL DEFAULT 0" },
    ],
  },

  // 33 - snapshot the egress allowlist in version history so a restore returns the
  // skill's allowed_hosts as they were, not the current ones. NULL on old snapshots
  // means "pre-snapshot version" → restore keeps the current allowlist.
  {
    id: 33,
    name: "skill_versions_allowed_hosts",
    addColumns: [{ table: "skill_versions", column: "allowed_hosts", def: "TEXT" }],
  },

  // 34 - timestamp a run's Merkle-batch claim so the boot recovery sweep can tell a
  // genuinely-crashed claim from a peer instance's LIVE batch (which sits claimed-
  // but-unproven for up to the anchor timeout). Without an age guard, a second
  // instance booting mid-batch would wipe the first's in-flight batch → duplicate
  // on-chain anchoring + phantom batch rows.
  {
    id: 34,
    name: "runs_batched_at",
    addColumns: [{ table: "runs", column: "batched_at", def: "INTEGER" }],
  },

  // 35 - isolated execution: the sandbox policy a run actually executed under,
  // stored as canonical JSON and folded into the receipt hash. NULL for every
  // run predating sandboxing, which is why the receipt digest omits the field
  // entirely rather than hashing a null (see lib/receipt.ts).
  {
    id: 35,
    name: "run_sandbox_policy",
    addColumns: [{ table: "runs", column: "sandbox", def: "TEXT" }],
  },

  // 36 - watches. A watch IS a schedule with a rule attached, deliberately: the
  // scheduler tick, cadence maths, next_run_at, the active toggle and the
  // per-owner quota reservation all already exist and are tested. A parallel
  // watches table would have duplicated every one of them. A row with
  // watch_rule NULL behaves exactly as a plain schedule always did.
  //
  // runs.schedule_id exists because startRun returns BEFORE the run executes,
  // so the scheduler tick never sees the output. Evaluation has to hang off run
  // completion, and a finished run needs to know which watch it belongs to.
  {
    id: 36,
    name: "watches",
    addColumns: [
      { table: "schedules", column: "watch_rule", def: "TEXT" },
      { table: "schedules", column: "watch_state", def: "TEXT" },
      { table: "schedules", column: "notify", def: "TEXT" },
      { table: "runs", column: "schedule_id", def: "TEXT" },
    ],
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_runs_schedule ON runs(schedule_id);`,
    ],
  },

  // 37 - Telegram. Two tables, because they have different lifetimes: a link is
  // durable, a code is ephemeral and single-use.
  //
  // The binding is chat -> wallet, and it can ONLY be created by redeeming a
  // code on the site with a wallet signature. Telegram never gets to assert who
  // someone is: if a pasted address were accepted as identity, anyone could
  // subscribe themselves to anyone else's watches.
  {
    id: 37,
    name: "telegram",
    statements: [
      `CREATE TABLE IF NOT EXISTS telegram_links (
         chat_id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         created_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_tg_links_owner ON telegram_links(owner);`,
      `CREATE TABLE IF NOT EXISTS telegram_codes (
         code TEXT PRIMARY KEY,
         chat_id TEXT NOT NULL,
         expires_at INTEGER NOT NULL,
         used_at INTEGER
       );`,
      `CREATE INDEX IF NOT EXISTS idx_tg_codes_chat ON telegram_codes(chat_id);`,
    ],
  },

  // 38 - permanent proof storage. The Arweave transaction holding this batch's
  // bundle. NULL means it was never stored: storage off, bundle over the free
  // limit, or the upload failed — none of which affect the batch's validity,
  // since the bundle verifies offline either way.
  {
    id: 38,
    name: "batch_arweave",
    addColumns: [{ table: "receipt_batches", column: "arweave_id", def: "TEXT" }],
  },

  // 39 - permanent screenshot storage.
  //
  // Keyed by CONTENT HASH, not by step: the receipt already commits to each
  // screenshot's sha256, so the hash is the join a verifier can make with no
  // database at all, and identical screenshots upload once instead of once per
  // run (proof runs repeat the same pages constantly).
  //
  // shots_public is opt-in and defaults to 0 on purpose. Arweave is permanent
  // and public; a run's screenshots routinely hold invoices, vendor names and
  // whatever else was on a logged-in page. Public verification has always
  // excluded screenshots — this must not quietly reverse that, and there is no
  // taking an upload back.
  {
    id: 39,
    name: "shot_arweave",
    statements: [
      `CREATE TABLE IF NOT EXISTS arweave_shots (
         hash TEXT PRIMARY KEY,
         tx_id TEXT NOT NULL,
         bytes INTEGER NOT NULL,
         created_at INTEGER NOT NULL
       );`,
    ],
    addColumns: [
      { table: "runs", column: "shots_public", def: "INTEGER NOT NULL DEFAULT 0" },
    ],
  },

  // 40 - let the screenshot sweep finish and move on.
  //
  // Without a record of which runs are done, a newest-first sweep re-reads the
  // same few published runs on every tick forever and never reaches an older
  // one behind them. shots_archived_at marks a run fully stored; shots_attempts
  // bounds the retries, so a transient failure heals itself while a screenshot
  // that can never be stored stops blocking the queue.
  {
    id: 40,
    name: "shot_archive_progress",
    addColumns: [
      { table: "runs", column: "shots_archived_at", def: "INTEGER" },
      { table: "runs", column: "shots_attempts", def: "INTEGER NOT NULL DEFAULT 0" },
    ],
  },

  // 41 - which version of a skill a run actually executed.
  //
  // Skills are versioned and they self-heal, so "the rate dropped" is only
  // useful next to "and it dropped at v4". Nothing recorded this before, and it
  // cannot be reconstructed: a run's plan is not stored, so NULL genuinely means
  // unknown rather than version 1. Analytics reports those separately instead of
  // guessing.
  {
    id: 41,
    name: "run_skill_version",
    addColumns: [{ table: "runs", column: "skill_version", def: "INTEGER" }],
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_runs_skill_version ON runs(skill_id, skill_version);`,
    ],
  },

  // 42 - drop the index 41 just created.
  //
  // Measured with EXPLAIN QUERY PLAN rather than assumed: every analytics query
  // filters skill_id together with created_at, so the planner picks
  // idx_runs_skill_created every time and this one is never chosen. An unused
  // index is not free — it is another B-tree written on every single run insert,
  // which is one of the hottest paths there is. Left in 41 rather than edited
  // out of it, because 41 has already been applied.
  {
    id: 42,
    name: "drop_unused_run_version_index",
    statements: [`DROP INDEX IF EXISTS idx_runs_skill_version;`],
  },

  // 43 - AgenC interop.
  //
  // A run's constraint hash in AgenC's canonical BN254 form, plus the hiding
  // commitment over its outputs. The hash is public and recomputable by anyone
  // holding the receipt; the salt is not, because with it the commitment stops
  // hiding. NULL throughout means the run predates this or the SDK was
  // unavailable, never that the values were zero.
  {
    id: 43,
    name: "agenc_interop",
    addColumns: [
      { table: "runs", column: "agenc_hash", def: "TEXT" },
      { table: "runs", column: "agenc_commitment", def: "TEXT" },
      { table: "runs", column: "agenc_salt", def: "TEXT" },
    ],
  },

  // 44 - watch checks are their own kind of run.
  //
  // A watch check replays two or three steps and reads one value. A run is a
  // person asking for work. Metering them from the same daily allowance meant a
  // background watch quietly ate the quota somebody wanted for actual work, and
  // at 5 runs/day a Holder could not afford a single hourly watch at all.
  //
  // Flagged at creation rather than derived by joining schedules later, because
  // the quota count runs on every scheduler tick and must stay a single indexed
  // scan.
  {
    id: 44,
    name: "watch_runs",
    addColumns: [
      { table: "runs", column: "is_watch", def: "INTEGER NOT NULL DEFAULT 0" },
    ],
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_runs_owner_watch ON runs(owner, is_watch, created_at);`,
    ],
  },

  // 45 - snooze. Distinct from pausing: the watch keeps checking and keeps its
  // baseline current, it just stays quiet until the timestamp passes. Pausing
  // stops the checks, which means the first alert after resuming compares
  // against whatever the value was days ago.
  {
    id: 45,
    name: "watch_mute",
    addColumns: [{ table: "schedules", column: "muted_until", def: "INTEGER" }],
  },

  // 46 - creator digest. When a chat last got a summary of its own wallet, so a
  // sweep that runs every scheduler tick sends one a day rather than one a tick.
  {
    id: 46,
    name: "telegram_digest",
    addColumns: [
      { table: "telegram_links", column: "last_digest_at", def: "INTEGER" },
    ],
  },

  // 47 - what kind of chat this is.
  //
  // Alerts are fine in a group; that is the point of /here. A wallet summary is
  // not: it carries earnings and a claimable balance, and a group linked for
  // alerts would have received it in front of everybody. NULL means unknown, and
  // unknown is treated as "not private" so the leak cannot happen to a link that
  // predates this. It backfills from the next message that chat sends.
  {
    id: 47,
    name: "telegram_chat_type",
    addColumns: [{ table: "telegram_links", column: "chat_type", def: "TEXT" }],
  },
  {
    id: 48,
    name: "step_repaired",
    // Which steps the agent rescued, kept per step rather than derived from the
    // note text. The note is prose meant for a person; a run page that wants to
    // say "this one was repaired" should not be pattern-matching English.
    addColumns: [{ table: "run_steps", column: "repaired", def: "INTEGER NOT NULL DEFAULT 0" }],
  },

  // 49 - curated collections + editorial spotlights for the marketplace.
  {
    id: 49,
    name: "curated_collections",
    statements: [
      `CREATE TABLE IF NOT EXISTS collections (
         id         TEXT PRIMARY KEY,
         slug       TEXT NOT NULL,
         title      TEXT NOT NULL,
         blurb      TEXT NOT NULL DEFAULT '',
         position   INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);`,
      `CREATE INDEX IF NOT EXISTS idx_collections_pos ON collections(position, created_at);`,
      `CREATE TABLE IF NOT EXISTS collection_skills (
         collection_id TEXT NOT NULL,
         skill_id      TEXT NOT NULL,
         position      INTEGER NOT NULL DEFAULT 0,
         created_at    INTEGER NOT NULL,
         PRIMARY KEY (collection_id, skill_id)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_collection_skills_pos ON collection_skills(collection_id, position);`,
      `CREATE TABLE IF NOT EXISTS spotlights (
         skill_id   TEXT PRIMARY KEY,
         blurb      TEXT NOT NULL DEFAULT '',
         position   INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_spotlights_pos ON spotlights(position, created_at);`,
    ],
  },

];
