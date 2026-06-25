/**
 * Database schema for Mimic.
 *
 * The data model mirrors the product's three stages:
 *   demonstrations → skills → runs (with flagged steps for human review)
 *
 * A `demonstration` is a single recorded trace of the user doing a task.
 * A `skill` is the generalized, parameterized procedure Claude infers from
 * one or more demonstrations. A `run` is one autonomous execution of a skill
 * over a new input; steps inside a run can be `flagged` when Mimic isn't
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
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

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
  confidence  REAL,           -- 0..1 — drives flagging
  flagged     INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_skill   ON runs(skill_id);
CREATE INDEX IF NOT EXISTS idx_steps_run    ON run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_skills_demo  ON skills(source_demo_id);
CREATE INDEX IF NOT EXISTS idx_demos_owner  ON demonstrations(owner);
CREATE INDEX IF NOT EXISTS idx_skills_owner ON skills(owner);
CREATE INDEX IF NOT EXISTS idx_runs_owner   ON runs(owner);
`;
