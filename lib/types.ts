/** Shared domain types for Aemulus. */

/** A single user action captured during a recording. */
export type ActionType =
  | "navigate"
  | "click"
  | "input"
  | "select"
  | "key"
  | "submit"
  | "extract";

export interface RecordedAction {
  idx: number;
  type: ActionType;
  url: string;
  ts: number;
  /** Best-first list of candidate selectors for the target element. */
  selectors?: string[];
  tag?: string;
  role?: string;
  /** Accessible name: aria-label / associated label / placeholder / text. */
  name?: string;
  /** Visible text content of the element (trimmed). */
  text?: string;
  /** Value for inputs/selects. */
  value?: string;
  /** Password/secret field — value is never captured; must be a per-run input. */
  sensitive?: boolean;
  /** Key for key events (Enter, Tab, Escape…). */
  key?: string;
  /** Relative path of the proof screenshot under .data/recordings. */
  screenshot?: string;
}

export type RecorderStatus =
  | "idle"
  | "recording"
  | "stopped"
  | "saved"
  | "error";

/** Live, in-memory state of the single active recorder session. */
export interface RecorderState {
  id: string;
  owner: string;
  status: RecorderStatus;
  title: string;
  startUrl: string;
  actions: RecordedAction[];
  startedAt: number;
  /** id of the saved demonstration once persisted. */
  demonstrationId?: string;
  error?: string;
}

export interface Demonstration {
  id: string;
  owner: string;
  title: string;
  startUrl: string | null;
  trace: RecordedAction[];
  createdAt: number;
}

/* ─── Generalized skills (Phase 2) ─────────────────────────────────────── */

/** A field that varies between runs — the parameterized input of a skill. */
export interface SkillInputField {
  key: string; // machine key, e.g. "full_name"
  label: string; // human label
  example: string; // example value drawn from the demonstration
}

/**
 * One generalized step. `valueSource` decides where the value comes from:
 *  - "input"    → bound to inputKey (varies per run)
 *  - "constant" → fixed `value` baked into the skill
 *  - "none"     → no value (clicks, navigation, key presses)
 */
export interface SkillStep {
  idx: number;
  intent: string;
  action: ActionType;
  selectors: string[];
  target: string;
  valueSource: "input" | "constant" | "none";
  value: string;
  inputKey: string;
  key: string;
  /** For "extract" steps: the key to store the captured value under. */
  outputKey?: string;
}

export interface Skill {
  id: string;
  owner: string;
  name: string;
  description: string;
  plan: SkillStep[];
  inputSchema: { fields: SkillInputField[] };
  sourceDemoId: string | null;
  published: boolean;
  publishedAt: number | null;
  runCount: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** Metadata for one entry in a skill's version history. */
export interface SkillVersionMeta {
  version: number;
  name: string;
  description: string;
  createdAt: number;
}

/** Raw shape the generalizer model emits (before we attach idx / persist). */
export interface GeneralizedSkill {
  name: string;
  description: string;
  inputFields: SkillInputField[];
  steps: Omit<SkillStep, "idx">[];
}

/* ─── Runs (Phase 3) ───────────────────────────────────────────────────── */

export type RunStatus =
  | "running"
  | "needs_review"
  | "completed"
  | "failed";

/** One executed step of a run — the unit of proof and calibration. */
export interface RunStepRecord {
  id: string;
  runId: string;
  idx: number;
  intent: string;
  action: ActionType;
  selectorUsed: string; // "" if none / navigate
  value: string; // resolved value applied
  screenshot: string; // relative path under .data/recordings
  confidence: number; // 0..1
  flagged: boolean;
  note: string;
  createdAt: number;
}

/** A human resolution for a flagged step, applied on retry. */
export interface StepOverride {
  selector?: string; // a corrected selector to try first
  skip?: boolean; // skip the step entirely
}

export type RunOverrides = Record<number, StepOverride>;

/* ─── Creator earnings + scheduling (self-running, self-paying economy) ──── */

export interface Earning {
  id: string;
  owner: string;
  skillId: string;
  runId: string;
  runner: string;
  amount: number;
  createdAt: number;
}

export interface EarningsSummary {
  total: number;
  runs: number;
  bySkill: { skillId: string; name: string; total: number; runs: number }[];
  recent: { skillId: string; name: string; amount: number; createdAt: number }[];
}

/** Trust signals for a skill: outcomes (from runs) + user ratings. */
export interface SkillReputation {
  runs: number;
  completed: number;
  successRate: number; // 0..1 (completed / runs)
  avgStars: number; // 0..5
  ratingCount: number;
}

export interface SkillReview {
  rater: string;
  stars: number;
  comment: string;
  createdAt: number;
}

export type Cadence =
  | "hourly"
  | "every6h"
  | "every12h"
  | "daily"
  | "weekdays"
  | "weekly";

export interface Schedule {
  id: string;
  owner: string;
  skillId: string;
  skillName: string;
  input: Record<string, string>;
  cadence: Cadence;
  active: boolean;
  lastRunId: string | null;
  lastRunAt: number | null;
  nextRunAt: number;
  createdAt: number;
}

export interface Run {
  id: string;
  owner: string;
  skillId: string;
  status: RunStatus;
  input: Record<string, string>;
  overrides: RunOverrides;
  result: string | null;
  error: string | null;
  receiptHash: string | null;
  receiptSig: string | null;
  receiptCluster: string | null;
  // Merkle batching: this run's leaf, its position, and proof to the batch root.
  batchId: string | null;
  leafIndex: number | null;
  merkleProof: { siblings: { hash: string; left: boolean }[] } | null;
  // Bulk runs + extracted output.
  bulkId: string | null;
  rowIndex: number | null;
  output: Record<string, string> | null;
  steps: RunStepRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface BulkRun {
  id: string;
  owner: string;
  skillId: string;
  total: number;
  createdAt: number;
}

export interface ReceiptBatch {
  id: string;
  merkleRoot: string;
  leafCount: number;
  sig: string | null;
  cluster: string | null;
  createdAt: number;
}
