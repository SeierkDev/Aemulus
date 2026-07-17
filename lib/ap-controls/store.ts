import { createHash } from "node:crypto";
import { db, ready } from "../db";
import { canonicalize } from "./override-log";
import { DEFAULT_WORKSPACE } from "./workspace";

/**
 * AP event store — a durable, append-only, per-aggregate sealed event log.
 *
 * Every invoice and vendor fact is an immutable row: (aggregate, seq) is unique,
 * so concurrent appends at the same position are rejected by the database, and
 * each row's `seal` is the sha256 of its canonical envelope (which includes
 * `seal_prev` and `seq`), chaining onto the prior row. Rows are only ever
 * INSERTed — never UPDATEd — and the verifier replays a stream to prove ordering,
 * continuity, and seal-chain integrity. Payloads are versioned and upcast on read
 * so old events keep replaying after the schema evolves.
 */

// ── Aggregate + event types ─────────────────────────────────────────────────
export type ApAggregateType = "invoice" | "vendor";

export type ApEventType =
  | "invoice.received"
  | "invoice.override"
  | "invoice.submitted"
  | "invoice.review_paused"
  | "invoice.rejected"
  | "vendor.requested"
  | "vendor.approved"
  | "vendor.bank_verified";

// Payload shapes (documentation + call-site typing; stored as JSON).
export interface InvoiceReceivedPayload { vendor: string; invoiceNumber: string; invoiceDate: string; amount: number; currency: string; source: string }
export interface InvoiceRejectedPayload { reasonCode: string; note?: string }
export interface InvoiceOverridePayload { type: string; field: string; originalValue: unknown; newValue: unknown; reasonCode: string; overrideEventId?: string }
export interface InvoiceSubmittedPayload { billNumber: string; total: number; currency: string; auto: boolean } // v2
export interface InvoiceReviewPausedPayload {
  reasonCodes: string[];
  topReasonCode: string;
  banner: string;
  amount: number;
  currency: string;
  vendor: string; // display name or id, for the queue
  requiresSecondApproval: boolean;
}
export interface VendorRequestedPayload { name: string; taxId?: string; hasBankDetails: boolean }
export interface VendorApprovedPayload { firstInvoiceReview: boolean }
export interface VendorBankVerifiedPayload { method: "callback" | "portal" | "reference"; verifiedBy: string }

// Current payload version per event type. Bump when a payload shape changes and
// add an upcaster below.
export const CURRENT_VERSIONS: Record<ApEventType, number> = {
  "invoice.received": 1,
  "invoice.rejected": 1,
  "invoice.override": 1,
  "invoice.submitted": 2, // v2 renamed `amount` → `total`
  "invoice.review_paused": 1,
  "vendor.requested": 1,
  "vendor.approved": 1,
  "vendor.bank_verified": 1,
};

type Upcaster = (p: Record<string, unknown>) => Record<string, unknown>;
// Map fromVersion → transform bringing the payload one version forward.
const UPCASTERS: Partial<Record<ApEventType, Record<number, Upcaster>>> = {
  "invoice.submitted": {
    1: ({ amount, ...rest }) => ({ ...rest, total: amount }), // v1 → v2
  },
};

/** Bring a stored payload up to the current version for its event type. */
export function upcast(
  eventType: ApEventType,
  fromVersion: number,
  payload: Record<string, unknown>,
): { version: number; payload: Record<string, unknown> } {
  const target = CURRENT_VERSIONS[eventType] ?? fromVersion;
  let v = fromVersion;
  let p = payload;
  while (v < target) {
    const up = UPCASTERS[eventType]?.[v];
    if (!up) break; // no path defined — leave as-is (still readable)
    p = up(p);
    v++;
  }
  return { version: v, payload: p };
}

// ── Row + input types ───────────────────────────────────────────────────────
export interface ApEventRow {
  id: string;
  workspaceId: string;
  aggregateType: ApAggregateType;
  aggregateId: string;
  seq: number;
  eventType: ApEventType;
  eventVersion: number;
  payload: Record<string, unknown>;
  actor: { userId: string; role: string };
  createdAt: number;
  sealPrev: string;
  seal: string;
}

export interface AppendInput {
  /** Scopes the event to one account's workspace (defaults to the shared workspace). */
  workspaceId?: string;
  aggregateType: ApAggregateType;
  aggregateId: string;
  eventType: ApEventType;
  /** Defaults to the current version for the event type. */
  eventVersion?: number;
  payload: Record<string, unknown>;
  actor: { userId: string; role: string };
  now: number;
  id: string;
  /** Optimistic concurrency: the seq the caller believes is next. */
  expectedSeq?: number;
}

export class SequenceConflictError extends Error {
  code = "SEQUENCE_CONFLICT";
  constructor(
    public aggregateType: string,
    public aggregateId: string,
    public expected: number,
    public actual: number,
  ) {
    super(`Sequence conflict on ${aggregateType}:${aggregateId} — tried ${expected}, next is ${actual}.`);
    this.name = "SequenceConflictError";
  }
}

// ── Schema ──────────────────────────────────────────────────────────────────
const DDL_TABLE = `
  CREATE TABLE IF NOT EXISTS ap_events (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE}',
    aggregate_type TEXT NOT NULL,
    aggregate_id   TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    event_type     TEXT NOT NULL,
    event_version  INTEGER NOT NULL DEFAULT 1,
    payload        TEXT NOT NULL,
    actor          TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    seal_prev      TEXT NOT NULL,
    seal           TEXT NOT NULL,
    UNIQUE (workspace_id, aggregate_type, aggregate_id, seq)
  )`;
const DDL_INDEX = `CREATE INDEX IF NOT EXISTS idx_ap_events_agg ON ap_events (workspace_id, aggregate_type, aggregate_id, seq)`;

let ensured: Promise<void> | null = null;
export function ensureApEventsSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      try {
        await ready();
        // Recover a half-done prior migration: legacy table present, main gone.
        const legacy = await db.execute(`PRAGMA table_info(ap_events_legacy)`);
        const mainPre = await db.execute(`PRAGMA table_info(ap_events)`);
        if (legacy.rows.length > 0 && mainPre.rows.length === 0) {
          await db.execute(`ALTER TABLE ap_events_legacy RENAME TO ap_events`);
        }
        const cols = await db.execute(`PRAGMA table_info(ap_events)`);
        const exists = cols.rows.length > 0;
        const hasWorkspace = cols.rows.some((r) => String((r as Record<string, unknown>).name) === "workspace_id");
        if (exists && !hasWorkspace) {
          // Legacy table (pre-scoping): rebuild + backfill ATOMICALLY (one txn), so
          // a crash mid-migration rolls back rather than emptying the audit store.
          await db.batch([
            `ALTER TABLE ap_events RENAME TO ap_events_legacy`,
            DDL_TABLE,
            `INSERT INTO ap_events (id, workspace_id, aggregate_type, aggregate_id, seq, event_type, event_version, payload, actor, created_at, seal_prev, seal)
             SELECT id, '${DEFAULT_WORKSPACE}', aggregate_type, aggregate_id, seq, event_type, event_version, payload, actor, created_at, seal_prev, seal FROM ap_events_legacy`,
            `DROP TABLE ap_events_legacy`,
          ], "write");
        } else {
          await db.execute(DDL_TABLE);
        }
        await db.execute(DDL_INDEX);
      } catch (e) {
        ensured = null; // don't cache a rejection — allow a later retry
        throw e;
      }
    })();
  }
  return ensured;
}

// ── Sealing ─────────────────────────────────────────────────────────────────
function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function genesisFor(type: string, id: string): string {
  return `genesis:${type}:${id}`;
}
/** The seal of an event = sha256 over its canonical envelope (everything but seal).
 *  NOTE: workspace_id is intentionally NOT in the seal — changing the seal formula
 *  on an append-only log needs a seal-version + re-seal migration (follow-up).
 *  Cross-workspace moves are already prevented by query-level scoping; every read
 *  filters workspace_id. */
function sealOf(e: Omit<ApEventRow, "seal">): string {
  return sha256hex(
    canonicalize({
      id: e.id, aggregateType: e.aggregateType, aggregateId: e.aggregateId, seq: e.seq,
      eventType: e.eventType, eventVersion: e.eventVersion, payload: e.payload, actor: e.actor,
      createdAt: e.createdAt, sealPrev: e.sealPrev,
    }),
  );
}

// ── Append ──────────────────────────────────────────────────────────────────
/**
 * Atomically append one event to an aggregate's stream. Computes the next seq +
 * prior seal, seals the envelope, and INSERTs. Rejects with SequenceConflictError
 * if the caller's expectedSeq is stale or the (aggregate, seq) slot is already
 * taken (a concurrent writer won the race). Never updates existing rows.
 */
export async function appendApEvent(input: AppendInput): Promise<ApEventRow> {
  await ensureApEventsSchema();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE;

  const tail = await db.execute({
    sql: `SELECT seq, seal FROM ap_events WHERE workspace_id = ? AND aggregate_type = ? AND aggregate_id = ? ORDER BY seq DESC LIMIT 1`,
    args: [workspaceId, input.aggregateType, input.aggregateId],
  });
  const last = tail.rows[0];
  const seq = last ? Number(last.seq) + 1 : 0;
  const sealPrev = last ? String(last.seal) : genesisFor(input.aggregateType, input.aggregateId);

  if (input.expectedSeq !== undefined && input.expectedSeq !== seq) {
    throw new SequenceConflictError(input.aggregateType, input.aggregateId, input.expectedSeq, seq);
  }

  const eventVersion = input.eventVersion ?? CURRENT_VERSIONS[input.eventType] ?? 1;
  const unsealed: Omit<ApEventRow, "seal"> = {
    id: input.id, workspaceId, aggregateType: input.aggregateType, aggregateId: input.aggregateId, seq,
    eventType: input.eventType, eventVersion, payload: input.payload, actor: input.actor,
    createdAt: input.now, sealPrev,
  };
  const seal = sealOf(unsealed);

  try {
    await db.execute({
      sql: `INSERT INTO ap_events
        (id, workspace_id, aggregate_type, aggregate_id, seq, event_type, event_version, payload, actor, created_at, seal_prev, seal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.id, workspaceId, input.aggregateType, input.aggregateId, seq, input.eventType, eventVersion,
        JSON.stringify(input.payload), JSON.stringify(input.actor), input.now, sealPrev, seal,
      ],
    });
  } catch (e) {
    if (/unique/i.test(String((e as Error)?.message))) {
      // A concurrent writer took this seq between our read and insert.
      throw new SequenceConflictError(input.aggregateType, input.aggregateId, seq, seq);
    }
    throw e;
  }
  return { ...unsealed, seal };
}

// ── Read / replay ───────────────────────────────────────────────────────────
function rowToEvent(r: Record<string, unknown>): ApEventRow {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    aggregateType: String(r.aggregate_type) as ApAggregateType,
    aggregateId: String(r.aggregate_id),
    seq: Number(r.seq),
    eventType: String(r.event_type) as ApEventType,
    eventVersion: Number(r.event_version),
    payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
    actor: JSON.parse(String(r.actor)) as { userId: string; role: string },
    createdAt: Number(r.created_at),
    sealPrev: String(r.seal_prev),
    seal: String(r.seal),
  };
}

/** Raw stored events for an aggregate, ordered by seq ascending. */
export async function readAggregate(
  aggregateType: ApAggregateType,
  aggregateId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApEventRow[]> {
  await ensureApEventsSchema();
  const res = await db.execute({
    sql: `SELECT * FROM ap_events WHERE workspace_id = ? AND aggregate_type = ? AND aggregate_id = ? ORDER BY seq ASC`,
    args: [workspaceId, aggregateType, aggregateId],
  });
  return res.rows.map((r) => rowToEvent(r as Record<string, unknown>));
}

/** Distinct aggregate ids of a given type in a workspace (e.g. every invoice seen). */
export async function listAggregateIds(
  aggregateType: ApAggregateType,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<string[]> {
  await ensureApEventsSchema();
  const r = await db.execute({
    sql: `SELECT DISTINCT aggregate_id FROM ap_events WHERE workspace_id = ? AND aggregate_type = ? ORDER BY aggregate_id`,
    args: [workspaceId, aggregateType],
  });
  return r.rows.map((row) => String((row as Record<string, unknown>).aggregate_id));
}

/** Events with payloads upcast to the current version for their event type. */
export async function loadAggregate(
  aggregateType: ApAggregateType,
  aggregateId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApEventRow[]> {
  const rows = await readAggregate(aggregateType, aggregateId, workspaceId);
  return rows.map((r) => {
    const { version, payload } = upcast(r.eventType, r.eventVersion, r.payload);
    return { ...r, eventVersion: version, payload };
  });
}

// ── Verify ──────────────────────────────────────────────────────────────────
export interface VerifyResult {
  valid: boolean;
  length: number;
  brokenAt?: number;
  reason?: "non_contiguous_sequence" | "broken_seal_link" | "seal_mismatch";
}

/**
 * Replay an aggregate's stream and prove: seqs are 0..N-1 contiguous (ordering),
 * each row's seal_prev links the previous seal (continuity), and every seal
 * recomputes (integrity — no row was altered). Returns the first failing index.
 */
export async function verifyAggregate(
  aggregateType: ApAggregateType,
  aggregateId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<VerifyResult> {
  const rows = await readAggregate(aggregateType, aggregateId, workspaceId);
  let prevSeal = genesisFor(aggregateType, aggregateId);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.seq !== i) return { valid: false, length: rows.length, brokenAt: i, reason: "non_contiguous_sequence" };
    if (r.sealPrev !== prevSeal) return { valid: false, length: rows.length, brokenAt: i, reason: "broken_seal_link" };
    const { seal, ...unsealed } = r;
    if (sealOf(unsealed) !== seal) return { valid: false, length: rows.length, brokenAt: i, reason: "seal_mismatch" };
    prevSeal = r.seal;
  }
  return { valid: true, length: rows.length };
}
