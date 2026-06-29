/**
 * Database schema for Aemulus.
 *
 * The data model mirrors the product's three stages:
 *   demonstrations → skills → runs (with flagged steps for human review)
 *
 * A `demonstration` is a single recorded trace of the user doing a task.
 * A `skill` is the generalized, parameterized procedure Claude infers from
 * one or more demonstrations. A `run` is one autonomous execution of a skill
 * over a new input; steps inside a run can be `flagged` when Aemulus isn't
 * confident enough to proceed unsupervised (calibrated autonomy).
 */

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS demonstrations (
  id          TEXT PRIMARY KEY,
  -- owner wallet pubkey (base58); '' for legacy/global rows
  owner       TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  start_url   TEXT,
  -- ordered JSON array of captured actions + screenshot refs
  trace       TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id             TEXT PRIMARY KEY,
  owner          TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  description    TEXT,
  -- JSON: generalized step plan (intent per step, selectors, fallbacks)
  plan           TEXT NOT NULL DEFAULT '[]',
  -- JSON schema describing the per-run input (e.g. fields to fill)
  input_schema   TEXT NOT NULL DEFAULT '{}',
  source_demo_id TEXT REFERENCES demonstrations(id),
  -- marketplace: published skills are publicly browsable + runnable
  published      INTEGER NOT NULL DEFAULT 0,
  published_at   INTEGER,
  run_count      INTEGER NOT NULL DEFAULT 0,
  version        INTEGER NOT NULL DEFAULT 1,
  -- JSON array of hostnames the run may navigate to ([] = unrestricted)
  allowed_hosts  TEXT NOT NULL DEFAULT '[]',
  -- org this skill is shared with (null = personal)
  org_id         TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Version history for skills: a snapshot per save, for history + rollback.
CREATE TABLE IF NOT EXISTS skill_versions (
  id           TEXT PRIMARY KEY,
  skill_id     TEXT NOT NULL,
  version      INTEGER NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  plan         TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_versions ON skill_versions(skill_id, version);

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  skill_id    TEXT NOT NULL REFERENCES skills(id),
  -- queued | running | needs_review | completed | failed
  status      TEXT NOT NULL DEFAULT 'queued',
  -- JSON: the input this run is executing against
  input       TEXT NOT NULL DEFAULT '{}',
  -- JSON: human resolutions keyed by step idx ({ "3": { selector?, skip? } })
  overrides   TEXT NOT NULL DEFAULT '{}',
  -- JSON: structured result / extracted output
  result      TEXT,
  error       TEXT,
  -- verifiable receipt: sha256 of run + proof screenshots, + optional Solana anchor
  receipt_hash    TEXT,
  receipt_sig     TEXT,
  receipt_cluster TEXT,
  -- Merkle batching: run's leaf is anchored as part of a batch root on-chain
  batch_id      TEXT,
  leaf_index    INTEGER,
  merkle_proof  TEXT,   -- JSON: sibling path from leaf to root
  -- Bulk runs: this run is row #row_index of bulk_id. output = extracted data.
  bulk_id     TEXT,
  row_index   INTEGER,
  output      TEXT,   -- JSON: { outputKey: capturedValue }
  -- cost transparency: operator (Claude) tokens spent on this run
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  -- vision success-verification: null = unchecked, 'achieved' | 'unconfirmed'
  outcome_status TEXT,
  outcome_reason TEXT,
  -- private verifiable receipt: hiding-commitment root + per-field salts (enc)
  commitment_root  TEXT,
  commitment_salts TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Per-step record: the proof + the place where calibration happens.
CREATE TABLE IF NOT EXISTS run_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id),
  idx         INTEGER NOT NULL,
  intent      TEXT NOT NULL,
  action      TEXT,            -- JSON of the action taken
  screenshot  TEXT,           -- path/ref to proof screenshot
  confidence  REAL,           -- 0..1 - drives flagging
  flagged     INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- Creator earnings ledger: a credit each time someone runs your published skill.
CREATE TABLE IF NOT EXISTS earnings (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,        -- the skill creator who earns
  skill_id    TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  runner      TEXT NOT NULL,        -- who ran it
  amount      REAL NOT NULL,        -- $AEMU accrued
  claim_id    TEXT,                 -- set when settled by a claim (else unclaimed)
  created_at  INTEGER NOT NULL
);

-- Creator payouts: a claim settles all of a creator's unclaimed earnings.
CREATE TABLE IF NOT EXISTS claims (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  amount     REAL NOT NULL,
  sig        TEXT,                  -- Solana tx that paid it out (null = pending)
  cluster    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_owner ON claims(owner);
CREATE INDEX IF NOT EXISTS idx_earnings_unclaimed ON earnings(owner, claim_id);

-- Scheduled autonomous runs: a skill runs itself on a cadence.
CREATE TABLE IF NOT EXISTS schedules (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  skill_id     TEXT NOT NULL,
  input        TEXT NOT NULL DEFAULT '{}',  -- encrypted JSON
  cadence      TEXT NOT NULL,               -- hourly | daily
  level        INTEGER NOT NULL DEFAULT 3,  -- owner tier snapshot (for quota)
  tier         TEXT NOT NULL DEFAULT 'Open',
  active       INTEGER NOT NULL DEFAULT 1,
  last_run_id  TEXT,
  last_run_at  INTEGER,
  next_run_at  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

-- Teams/orgs: a group of wallets that share skills, with roles (admin|member).
CREATE TABLE IF NOT EXISTS orgs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL,   -- creating wallet
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner);

CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT NOT NULL,
  wallet     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',  -- admin | member
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, wallet)
);
CREATE INDEX IF NOT EXISTS idx_org_members_wallet ON org_members(wallet);

-- Credential vault: a wallet's per-host secrets (encrypted), auto-filled into
-- a run's matching input fields so you don't re-enter them each run.
CREATE TABLE IF NOT EXISTS vault (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  host       TEXT NOT NULL,   -- site this credential is for, e.g. example.com
  key        TEXT NOT NULL,   -- input field key it fills, e.g. password
  value      TEXT NOT NULL,   -- encrypted
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_uniq ON vault(owner, host, key);

-- Inbound run triggers: a signed URL that starts a run when POSTed to (event-
-- driven runs). The token is the secret in the URL.
CREATE TABLE IF NOT EXISTS triggers (
  id            TEXT PRIMARY KEY,
  owner         TEXT NOT NULL,
  skill_id      TEXT NOT NULL,
  token         TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  fire_count    INTEGER NOT NULL DEFAULT 0,
  last_fired_at INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_triggers_token ON triggers(token);
CREATE INDEX IF NOT EXISTS idx_triggers_owner ON triggers(owner);

-- Marketplace moderation: a wallet can report a skill once; enough distinct
-- reports auto-unpublish it (takedown).
CREATE TABLE IF NOT EXISTS skill_reports (
  id         TEXT PRIMARY KEY,
  skill_id   TEXT NOT NULL,
  reporter   TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_reports_uniq ON skill_reports(skill_id, reporter);

-- User star ratings/reviews for published skills (one per wallet per skill).
CREATE TABLE IF NOT EXISTS ratings (
  id          TEXT PRIMARY KEY,
  skill_id    TEXT NOT NULL,
  rater       TEXT NOT NULL,
  stars       INTEGER NOT NULL,   -- 1..5
  comment     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_uniq ON ratings(skill_id, rater);

-- Merkle batches: one anchored root commits to many run receipts at once.
CREATE TABLE IF NOT EXISTS receipt_batches (
  id           TEXT PRIMARY KEY,
  merkle_root  TEXT NOT NULL,
  leaf_count   INTEGER NOT NULL,
  sig          TEXT,            -- Solana tx signature anchoring the root (if any)
  cluster      TEXT,
  created_at   INTEGER NOT NULL
);

-- API keys: programmatic access to the public /api/v1 protocol surface.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL,   -- sha256 of the raw key (raw shown once)
  prefix       TEXT NOT NULL,   -- display hint, e.g. "aem_live_AbCd…"
  scopes       TEXT NOT NULL DEFAULT 'read,run',  -- comma-sep: read | run
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Webhooks: HMAC-signed run events delivered to subscriber URLs.
CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,   -- HMAC signing secret (whsec_…)
  active      INTEGER NOT NULL DEFAULT 1,
  -- comma-sep RunEvents this hook subscribes to (run.output carries extracted data)
  events      TEXT NOT NULL DEFAULT 'run.completed,run.needs_review,run.failed',
  last_status INTEGER,         -- last delivery HTTP status (0 = error)
  last_at     INTEGER,
  last_attempts INTEGER,       -- attempts on the last delivery (retry/backoff)
  last_error  TEXT,            -- last delivery error (null = delivered ok)
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks(owner);

-- Bulk runs: one skill executed across many input rows ("the next hundred").
CREATE TABLE IF NOT EXISTS bulk_runs (
  id        TEXT PRIMARY KEY,
  owner     TEXT NOT NULL,
  skill_id  TEXT NOT NULL,
  total     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_skill   ON runs(skill_id);
CREATE INDEX IF NOT EXISTS idx_steps_run    ON run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_skills_demo  ON skills(source_demo_id);
CREATE INDEX IF NOT EXISTS idx_demos_owner  ON demonstrations(owner);
CREATE INDEX IF NOT EXISTS idx_skills_owner ON skills(owner);
CREATE INDEX IF NOT EXISTS idx_runs_owner   ON runs(owner);
CREATE INDEX IF NOT EXISTS idx_skills_pub   ON skills(published);
CREATE INDEX IF NOT EXISTS idx_earn_owner   ON earnings(owner);
CREATE INDEX IF NOT EXISTS idx_earn_skill_runner ON earnings(skill_id, runner);

-- Durable job queue: run execution is enqueued here and processed by a worker,
-- so runs survive restarts, retry on transient failure, and a second instance
-- can share the load (atomic claim).
CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  runner     TEXT NOT NULL,
  skill_id   TEXT NOT NULL,
  input      TEXT NOT NULL DEFAULT '{}',   -- encrypted JSON
  overrides  TEXT NOT NULL DEFAULT '{}',   -- JSON
  status     TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  attempts   INTEGER NOT NULL DEFAULT 0,
  run_at     INTEGER NOT NULL,             -- eligible time (backoff)
  locked_at  INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs(status, run_at);

-- Idempotency keys: at-most-once execution of mutating POSTs per (owner,scope,key).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  owner      TEXT NOT NULL,
  scope      TEXT NOT NULL,        -- which operation (e.g. "v1/runs")
  key        TEXT NOT NULL,        -- client-supplied Idempotency-Key
  status     INTEGER,              -- NULL = reserved/in-flight; else the response status
  body       TEXT,                 -- JSON response body to replay
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, scope, key)
);
CREATE INDEX IF NOT EXISTS idx_sched_owner  ON schedules(owner);
CREATE INDEX IF NOT EXISTS idx_sched_due    ON schedules(active, next_run_at);
-- idx_runs_unbatched lives in migration 3 (created after batch_id is added).
-- idx_runs_bulk lives in migration 4 (created after bulk_id is added).
`;
