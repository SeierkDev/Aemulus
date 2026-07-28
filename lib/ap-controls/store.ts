import { createHash, createHmac } from "node:crypto";
import { db, ready } from "../db";
import { env } from "../env";
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
  /** Which seal formula sealed this row (1 = legacy keyless sha256, 2 = keyed HMAC). */
  sealVersion: number;
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

/** Thrown when appendApEvent is asked to extend a chain whose existing keyed head
 *  doesn't match its current rows — i.e. the chain was tampered/de-headed. Refusing
 *  the append prevents the new head from being re-minted over the forged chain
 *  (which would launder it to `valid`). */
export class HeadIntegrityError extends Error {
  code = "HEAD_INTEGRITY";
  constructor(public aggregateType: string, public aggregateId: string) {
    super(`Refusing to append to ${aggregateType}:${aggregateId} — its sealed head does not match its rows (tampering).`);
    this.name = "HeadIntegrityError";
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
    seal_version   INTEGER NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, aggregate_type, aggregate_id, seq)
  )`;
const DDL_INDEX = `CREATE INDEX IF NOT EXISTS idx_ap_events_agg ON ap_events (workspace_id, aggregate_type, aggregate_id, seq)`;
// Keyed per-aggregate head anchor: length + a MAC over the latest seal. Lets the
// verifier detect a truncated TAIL (which the backward-only seal chain can't) —
// deleting trailing rows leaves the stored head unmatched, and forging a new head
// needs the seal key. One row per aggregate, upserted inside the append batch.
const DDL_HEAD = `
  CREATE TABLE IF NOT EXISTS ap_aggregate_head (
    workspace_id   TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id   TEXT NOT NULL,
    seq_count      INTEGER NOT NULL,
    head_mac       TEXT NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, aggregate_type, aggregate_id)
  )`;

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
        // Add seal_version to a pre-existing table (older rows are v1 by default).
        const cols2 = await db.execute(`PRAGMA table_info(ap_events)`);
        if (!cols2.rows.some((r) => String((r as Record<string, unknown>).name) === "seal_version")) {
          await db.execute(`ALTER TABLE ap_events ADD COLUMN seal_version INTEGER NOT NULL DEFAULT 1`);
        }
        await db.execute(DDL_INDEX);
        await db.execute(DDL_HEAD);
        // NOTE: we deliberately do NOT backfill head anchors at runtime. Re-minting a
        // keyed head from the current (mutable) event rows is a signing oracle: a
        // DB-write attacker can downgrade every row to keyless v1 (preserving them),
        // wipe the head rows, and a cold start would re-sign their forged chain with
        // the server key. Any headless non-empty aggregate is therefore treated as
        // tampering (missing_head) permanently. Genuine legacy pre-anchor chains, if
        // any ever exist, must be blessed ONCE via an explicit offline operator
        // migration (backfillMissingHeads), never automatically on boot.
      } catch (e) {
        ensured = null; // don't cache a rejection — allow a later retry
        throw e;
      }
    })();
  }
  return ensured;
}

/**
 * OFFLINE OPERATOR MIGRATION ONLY — never call this at runtime / on boot.
 *
 * Gives a keyed head anchor to any pre-existing aggregate that lacks one, so genuine
 * legacy pre-anchor chains (v1 rows migrated from before the head anchor shipped) can
 * pass the now-mandatory head check. It snapshots each chain's current (count, last
 * seal) under the seal key.
 *
 * Why it must be offline-only: it re-mints keyed heads from the CURRENT event rows,
 * which a DB-write attacker fully controls. Wiring it into any automatic path (every
 * boot, a deletable marker, or a "no v2 rows" data check) turns it into a signing
 * oracle — the attacker downgrades all rows to keyless v1, wipes the heads, triggers
 * the path, and the server re-signs their forged chain as valid. There is no
 * runtime condition safe to gate it on, because the attacker controls every input to
 * that condition. So the ONLY safe use is a deliberate, one-time migration run by an
 * operator in a trusted context; at runtime, a headless non-empty aggregate stays
 * `missing_head` forever. Exported for that migration + tests.
 */
export async function backfillMissingHeads(): Promise<void> {
  const missing = await db.execute(`
    SELECT e.workspace_id AS ws, e.aggregate_type AS at, e.aggregate_id AS ai,
           COUNT(*) AS cnt, MAX(e.seq) AS maxseq
    FROM ap_events e
    LEFT JOIN ap_aggregate_head h
      ON h.workspace_id = e.workspace_id
     AND h.aggregate_type = e.aggregate_type
     AND h.aggregate_id = e.aggregate_id
    WHERE h.workspace_id IS NULL
    GROUP BY e.workspace_id, e.aggregate_type, e.aggregate_id`);
  const now = Date.now();
  for (const row of missing.rows) {
    const r = row as Record<string, unknown>;
    const ws = String(r.ws), at = String(r.at), ai = String(r.ai);
    const cnt = Number(r.cnt), maxseq = Number(r.maxseq);
    // Anchor over (count, last seal) exactly as verifyAggregate recomputes it. For a
    // well-formed chain COUNT == maxseq+1 and the last row sits at seq=maxseq; a
    // chain with a seq gap is already broken and the per-row replay fails before the
    // head is even consulted, so its head value is immaterial.
    const last = await db.execute({
      sql: `SELECT seal FROM ap_events WHERE workspace_id = ? AND aggregate_type = ? AND aggregate_id = ? AND seq = ? LIMIT 1`,
      args: [ws, at, ai, maxseq],
    });
    const lastSeal = last.rows[0] ? String((last.rows[0] as Record<string, unknown>).seal) : "";
    const mac = headMac(ws, at, ai, cnt, lastSeal);
    await db.execute({
      sql: `INSERT OR IGNORE INTO ap_aggregate_head (workspace_id, aggregate_type, aggregate_id, seq_count, head_mac, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [ws, at, ai, cnt, mac, now],
    });
  }
}

// ── Sealing ─────────────────────────────────────────────────────────────────
// Seal versioning lets us strengthen the seal formula without a destructive
// re-seal of existing rows: each row records the version that sealed it, and the
// verifier recomputes with that same version. v1 was a keyless sha256 (any DB-
// write attacker could recompute a fully consistent replacement chain). v2 is a
// keyed HMAC over AUTH_SECRET, so forging/altering-and-resealing a row now
// requires the server secret, and it binds workspace_id (safe to add now that
// old rows stay pinned to v1).
export const CURRENT_SEAL_VERSION = 2;

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function genesisFor(type: string, id: string): string {
  return `genesis:${type}:${id}`;
}
/** HMAC key for v2 seals — domain-separated from the at-rest encryption key so
 *  the two never share bytes even though both derive from AUTH_SECRET. */
function sealKey(): Buffer {
  return createHash("sha256").update(`aemulus:ap-seal:v2:${env.authSecret}`).digest();
}

/** Compute an event's seal under a specific seal version. */
function sealForVersion(version: number, e: Omit<ApEventRow, "seal">): string {
  if (version >= 2) {
    // v2: keyed HMAC, with workspace_id bound into the envelope.
    return createHmac("sha256", sealKey())
      .update(
        canonicalize({
          workspaceId: e.workspaceId,
          id: e.id, aggregateType: e.aggregateType, aggregateId: e.aggregateId, seq: e.seq,
          eventType: e.eventType, eventVersion: e.eventVersion, payload: e.payload, actor: e.actor,
          createdAt: e.createdAt, sealPrev: e.sealPrev,
        }),
      )
      .digest("hex");
  }
  // v1: legacy keyless sha256, workspace_id NOT bound (unchanged so old rows verify).
  return sha256hex(
    canonicalize({
      id: e.id, aggregateType: e.aggregateType, aggregateId: e.aggregateId, seq: e.seq,
      eventType: e.eventType, eventVersion: e.eventVersion, payload: e.payload, actor: e.actor,
      createdAt: e.createdAt, sealPrev: e.sealPrev,
    }),
  );
}

/** Keyed MAC over an aggregate's head (row count + latest seal) — the truncation
 *  anchor. Forging one for a shortened chain requires the seal key. */
function headMac(
  workspaceId: string,
  type: string,
  id: string,
  count: number,
  lastSeal: string,
): string {
  return createHmac("sha256", sealKey())
    .update(
      canonicalize({ kind: "ap-head", workspaceId, aggregateType: type, aggregateId: id, count, lastSeal }),
    )
    .digest("hex");
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

  // Refuse to EXTEND a chain that isn't already head-valid. This append re-mints the
  // head over the current (count, tailSeal) and advances it unconditionally; if a
  // DB-write attacker tampered a prior row — which changes the forward-linked tail
  // seal — the stale head would otherwise be silently overwritten here, LAUNDERING
  // the forgery into a `valid` verdict on the next legitimate append. So require the
  // existing keyed head to already match the existing chain before advancing it. A
  // genuinely-appended chain always matches (the prior append left a valid head), so
  // legitimate flows are unaffected; only a tampered / de-headed / unanchored (legacy,
  // un-migrated) chain is blocked. `count`-1 == seq == the existing row count here.
  if (last) {
    const priorHead = await loadHead(input.aggregateType, input.aggregateId, workspaceId);
    const expectedPriorMac = headMac(workspaceId, input.aggregateType, input.aggregateId, seq, String(last.seal));
    if (!priorHead) {
      // A non-empty chain with NO head anchor: tampering (head deleted) or an
      // un-migrated legacy chain — a genuine current chain always has one. Refuse.
      throw new HeadIntegrityError(input.aggregateType, input.aggregateId);
    }
    if (priorHead.seqCount !== seq) {
      // Our tail read is STALE relative to the committed head: a concurrent append
      // advanced it (or rows were truncated). Surface it as a sequence conflict so the
      // normal retry / in_progress handling applies — NOT as tampering. (A genuine
      // truncation still fails verifyAggregate as truncated_tail; the append is refused
      // here either way — fail-closed.) The event+head are written in one atomic batch,
      // so a committed head always matches a committed tail; a divergence here is never
      // a partially-applied legitimate append.
      throw new SequenceConflictError(input.aggregateType, input.aggregateId, seq, priorHead.seqCount);
    }
    if (priorHead.headMac !== expectedPriorMac) {
      // Head present and count matches, but the MAC is over a different tail seal — the
      // rows were tampered (e.g. a keyless v1 downgrade) without the seal key. Refuse so
      // the next append can't re-mint a valid head over the forgery.
      throw new HeadIntegrityError(input.aggregateType, input.aggregateId);
    }
  }

  const eventVersion = input.eventVersion ?? CURRENT_VERSIONS[input.eventType] ?? 1;
  const sealVersion = CURRENT_SEAL_VERSION;
  const unsealed: Omit<ApEventRow, "seal"> = {
    id: input.id, workspaceId, aggregateType: input.aggregateType, aggregateId: input.aggregateId, seq,
    eventType: input.eventType, eventVersion, payload: input.payload, actor: input.actor,
    createdAt: input.now, sealPrev, sealVersion,
  };
  const seal = sealForVersion(sealVersion, unsealed);
  const count = seq + 1;
  const mac = headMac(workspaceId, input.aggregateType, input.aggregateId, count, seal);

  try {
    // Insert the event AND advance the keyed head anchor atomically. If the event
    // INSERT loses the (aggregate, seq) race, the whole batch rolls back — the head
    // never advances past a row that wasn't stored, so verify stays consistent.
    await db.batch(
      [
        {
          sql: `INSERT INTO ap_events
            (id, workspace_id, aggregate_type, aggregate_id, seq, event_type, event_version, payload, actor, created_at, seal_prev, seal, seal_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            input.id, workspaceId, input.aggregateType, input.aggregateId, seq, input.eventType, eventVersion,
            JSON.stringify(input.payload), JSON.stringify(input.actor), input.now, sealPrev, seal, sealVersion,
          ],
        },
        {
          sql: `INSERT INTO ap_aggregate_head (workspace_id, aggregate_type, aggregate_id, seq_count, head_mac, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (workspace_id, aggregate_type, aggregate_id)
                DO UPDATE SET seq_count = excluded.seq_count, head_mac = excluded.head_mac, updated_at = excluded.updated_at
                WHERE excluded.seq_count > ap_aggregate_head.seq_count`,
          args: [workspaceId, input.aggregateType, input.aggregateId, count, mac, input.now],
        },
      ],
      "write",
    );
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
    sealVersion: r.seal_version == null ? 1 : Number(r.seal_version),
    seal: String(r.seal),
  };
}

/** The stored head anchor for an aggregate, or null if none was ever written. */
async function loadHead(
  aggregateType: ApAggregateType,
  aggregateId: string,
  workspaceId: string,
): Promise<{ seqCount: number; headMac: string } | null> {
  const r = await db.execute({
    sql: `SELECT seq_count, head_mac FROM ap_aggregate_head WHERE workspace_id = ? AND aggregate_type = ? AND aggregate_id = ?`,
    args: [workspaceId, aggregateType, aggregateId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { seqCount: Number(row.seq_count), headMac: String(row.head_mac) } : null;
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
  reason?: "non_contiguous_sequence" | "broken_seal_link" | "seal_mismatch" | "truncated_tail" | "missing_head";
}

/**
 * Replay an aggregate's stream and prove: seqs are 0..N-1 contiguous (ordering),
 * each row's seal_prev links the previous seal (continuity), every seal recomputes
 * under its own seal version (integrity — no row was altered), and the keyed head
 * anchor matches the current length + latest seal (no tail was truncated). Returns
 * the first failing index.
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
    if (sealForVersion(r.sealVersion, unsealed) !== seal) {
      return { valid: false, length: rows.length, brokenAt: i, reason: "seal_mismatch" };
    }
    prevSeal = r.seal;
  }

  // Tail-truncation / integrity anchor. Every non-empty aggregate must carry a
  // keyed head over its current length + latest seal. This is the one artifact a
  // DB-write attacker can't forge (headMac needs the seal key) or silently drop,
  // so it's what keeps the log tamper-evident even against a *seal-version
  // downgrade*: an attacker can recompute a keyless v1 seal over altered rows
  // (v1 needs no secret), but cannot produce a matching head — and a missing head
  // now ALWAYS fails here, instead of being tolerated whenever the tail row merely
  // claims sealVersion 1 (an attacker-controlled field). The head is minted ONLY by
  // a genuine appendApEvent (atomic event+head batch); it is never re-minted at
  // runtime (that would be a signing oracle — see backfillMissingHeads). A genuine
  // legacy pre-anchor DB, if one ever exists, must be blessed once by the OFFLINE
  // backfillMissingHeads migration before its old chains verify; absent that, its
  // pre-anchor chains correctly read missing_head (keyless v1 was never vouchable).
  const head = await loadHead(aggregateType, aggregateId, workspaceId);
  const lastSeal = rows.length ? rows[rows.length - 1].seal : "";
  if (head) {
    const expected = headMac(workspaceId, aggregateType, aggregateId, rows.length, lastSeal);
    if (head.seqCount !== rows.length || head.headMac !== expected) {
      return { valid: false, length: rows.length, brokenAt: rows.length, reason: "truncated_tail" };
    }
  } else if (rows.length > 0) {
    return { valid: false, length: rows.length, brokenAt: rows.length, reason: "missing_head" };
  }

  return { valid: true, length: rows.length };
}
