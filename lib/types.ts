/** Shared domain types for Mimic. */

/** A single user action captured during a recording. */
export type ActionType =
  | "navigate"
  | "click"
  | "input"
  | "select"
  | "key"
  | "submit";

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
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  plan: SkillStep[];
  inputSchema: { fields: SkillInputField[] };
  sourceDemoId: string | null;
  createdAt: number;
  updatedAt: number;
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

export interface Run {
  id: string;
  skillId: string;
  status: RunStatus;
  input: Record<string, string>;
  result: string | null;
  error: string | null;
  steps: RunStepRecord[];
  createdAt: number;
  updatedAt: number;
}
