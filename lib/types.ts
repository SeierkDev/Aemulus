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
