/** Shared domain types for Aemulus. */

/** A single user action captured during a recording. */
export type ActionType =
  | "navigate"
  | "click"
  | "input"
  | "select"
  | "key"
  | "submit"
  | "extract"
  | "run_skill"
  | "wait_for";

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
  /** Password/secret field - value is never captured; must be a per-run input. */
  sensitive?: boolean;
  /** Key for key events (Enter, Tab, Escape…). */
  key?: string;
  /** Relative path of the proof screenshot under .data/recordings. */
  screenshot?: string;
  /** For a capture: the key its value is stored under. */
  outputKey?: string;
  /** For a capture: the watch rule set while recording (see SkillStep.watchOp). */
  watchOp?: string;
  watchValue?: string;
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
  /** Capture mode: a click marks a value to read instead of clicking it. */
  capturing?: boolean;
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

/** A field that varies between runs - the parameterized input of a skill. */
export interface SkillInputField {
  key: string; // machine key, e.g. "full_name"
  label: string; // human label
  example: string; // example value drawn from the demonstration
  /** Secret (password, one-time code…): entered per run, masked in all UI. */
  secret?: boolean;
}

/**
 * One generalized step. `valueSource` decides where the value comes from:
 *  - "input"    → bound to inputKey (varies per run)
 *  - "constant" → fixed `value` baked into the skill
 *  - "none"     → no value (clicks, navigation, key presses)
 */
/**
 * Optional gate on a step: run it only if a selector is present ("exists") or
 * not present ("absent") on the page - the if/then primitive (e.g. dismiss a
 * cookie banner only if it appears, or run a login flow only if logged out).
 */
export interface StepCondition {
  kind: "exists" | "absent";
  selector: string;
}

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
  /** For "extract" steps: capture EVERY matching element into a list (in-skill
   *  loop over the DOM), not just the first. Output is a JSON array. */
  loop?: boolean;
  /**
   * For "extract" steps: the watch rule the user set WHILE RECORDING.
   *
   * Not used by the run — a run always just reads the value. It is the answer
   * to "when do you care", captured at the only moment the person is actually
   * looking at the number, so a watch built from this skill starts with the
   * rule already filled in instead of asking again later out of context.
   */
  watchOp?: string;
  watchValue?: string;
  /**
   * For "wait_for" steps: hold here until the page says so.
   *
   * A recorded task is a straight line through a page that was already ready.
   * Replayed, the same line hits a table still loading, an approval that lands a
   * few seconds later, a balance that settles. Until now the only answer was a
   * step that failed and a run that stopped, so the pipeline was only as long as
   * the slowest thing in it happened to be fast.
   */
  waitOp?: string;
  waitValue?: string;
  /** How long to keep looking, in ms. */
  waitMs?: number;
  /** What a timeout means: stop the run, or carry on without it. */
  waitOnTimeout?: "fail" | "continue";
  /** For "run_skill" steps: the skill to invoke as a child run (composition). */
  subSkillId?: string;
  /** Human checkpoint: pause for a live takeover (e.g. a 2FA prompt). */
  interactive?: boolean;
  /** Optional condition - when set, the step runs only if it's satisfied. */
  condition?: StepCondition;
}

export interface Skill {
  id: string;
  owner: string;
  name: string;
  description: string;
  plan: SkillStep[];
  /** `template` marks a marketplace starter skill (placeholder steps for a
   *  specific tool) that a user records their own version of - not runnable
   *  as-is. Absent on ordinary skills. */
  inputSchema: { fields: SkillInputField[]; template?: { tool: string } };
  /** Hostnames the run may navigate to ([] = unrestricted). */
  allowedHosts: string[];
  /** Org this skill is shared with (null = personal). */
  orgId: string | null;
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
  | "awaiting_input"
  | "needs_review"
  | "completed"
  | "failed";

/** One executed step of a run - the unit of proof and calibration. */
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
  /** The agent rescued this step after the recorded selector failed. */
  repaired?: boolean;
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
  // Sub-hourly cadences exist for alerts, where being early IS the value: an
  // exchange listing checked every six hours is worth nothing. Gated by tier in
  // affordableCadences, because 10-minute checks are 144 a day.
  | "every10m"
  | "every15m"
  | "every30m"

  | "hourly"
  | "every6h"
  | "every12h"
  | "daily"
  | "weekdays"
  | "weekly";

/**
 * Where a watch's alerts go. Only Telegram for now, but the shape is a tagged
 * union so adding email later does not mean rewriting every caller.
 *
 * `redact` sends the fact that something changed WITHOUT the value. Values from
 * a logged-in page leave this system and enter a third party's, and for a bank
 * balance or a revenue figure that is a decision the user should get to make.
 */
export type WatchNotify = {
  channel: "telegram";
  chatId: string;
  redact?: boolean;
};

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
  /**
   * The watch on this schedule, when it has one.
   *
   * Carried on the list row because a schedule that is really a watch, and a
   * watch that RUNS SOMETHING when it fires, were both indistinguishable from a
   * plain scheduled run everywhere they were displayed. Something that spends
   * quota and starts skills on your behalf has to be visible from the list you
   * manage it in.
   */
  watch?: { key: string; op: string; value?: string; actionSkillId?: string } | null;
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
  /** Owner published this run's screenshots to permanent public storage. */
  shotsPublic: boolean;
  /** The skill version this run actually executed. Null for runs made before
   *  versions were stamped — unknown, never "version 1". */
  skillVersion: number | null;
  /** AgenC canonical constraint hash over this run's four-element output
   *  vector. Public: anyone with the receipt can recompute it with their SDK. */
  agencHash: string | null;
  /** Hiding commitment over the outputs. Public and reveals nothing. */
  agencCommitment: string | null;
  merkleProof: { siblings: { hash: string; left: boolean }[] } | null;
  // Bulk runs + extracted output.
  bulkId: string | null;
  rowIndex: number | null;
  output: Record<string, string> | null;
  /** Operator (Claude) tokens spent on this run - cost transparency. */
  tokensIn: number;
  tokensOut: number;
  /** Vision success-verification: null = unchecked, else achieved | unconfirmed. */
  outcomeStatus: "achieved" | "unconfirmed" | null;
  outcomeReason: string | null;
  /** Canonical JSON of the isolation policy this run executed under (lib/sandbox.ts).
   *  null for runs that predate isolated execution. */
  sandbox: string | null;
  /** The schedule that fired this run, if any. A watch needs it because
   *  startRun returns before the run executes, so evaluation happens on
   *  completion and the finished run has to say which watch it belongs to. */
  scheduleId: string | null;
  /** Private verifiable receipt: hiding-commitment root over the run's fields. */
  commitmentRoot: string | null;
  /** On-chain registry anchor (aemulus-registry program), if recorded. */
  registrySig: string | null;
  registryCluster: string | null;
  /** ZK-compressed receipt anchor (aemulus-zk-receipts Light program), if recorded. */
  zkSig: string | null;
  zkAddress: string | null;
  zkCluster: string | null;
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
  /** Arweave transaction holding this batch's bundle permanently, if stored. */
  arweaveId: string | null;
}
