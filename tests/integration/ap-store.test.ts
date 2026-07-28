import { beforeAll, describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { db, ready } from "../../lib/db";
import {
  appendApEvent,
  readAggregate,
  loadAggregate,
  verifyAggregate,
  backfillMissingHeads,
  ensureApEventsSchema,
  SequenceConflictError,
  HeadIntegrityError,
  type AppendInput,
} from "../../lib/ap-controls/store";
import { canonicalize } from "../../lib/ap-controls/override-log";

const NOW = 1_700_000_000_000;
const actor = { userId: "u_clerk", role: "clerk" };
let n = 0;
const uid = (p: string) => `${p}_${++n}_test`;

function ev(over: Partial<AppendInput> & { aggregateId: string; eventType: AppendInput["eventType"] }): AppendInput {
  return {
    aggregateType: "invoice",
    payload: { hello: "world" },
    actor,
    now: NOW,
    id: `evt_${over.aggregateId}_${over.eventType}_${++n}`,
    ...over,
  };
}

beforeAll(async () => {
  await ready();
});

describe("replay correctness", () => {
  it("appends a contiguous stream, reads it in order, and verifies", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused", payload: { reasonCodes: ["NEW_VENDOR"], banner: "held" } }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", payload: { type: "amount", field: "total", originalValue: 100, newValue: 120, reasonCode: "CORRECTION" } }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B-1", total: 120, currency: "USD", auto: false } }));

    const rows = await readAggregate("invoice", id);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.eventType)).toEqual(["invoice.review_paused", "invoice.override", "invoice.submitted"]);
    expect(rows[1].payload.newValue).toBe(120);
    expect(rows[0].sealPrev).toBe(`genesis:invoice:${id}`);
    expect(rows[2].sealPrev).toBe(rows[1].seal);

    expect(await verifyAggregate("invoice", id)).toEqual({ valid: true, length: 3 });
  });

  it("supports a separate vendor aggregate stream", async () => {
    const id = uid("vend");
    await appendApEvent(ev({ aggregateType: "vendor", aggregateId: id, eventType: "vendor.requested", payload: { name: "Acme", hasBankDetails: true } }));
    await appendApEvent(ev({ aggregateType: "vendor", aggregateId: id, eventType: "vendor.approved", payload: { firstInvoiceReview: true } }));
    await appendApEvent(ev({ aggregateType: "vendor", aggregateId: id, eventType: "vendor.bank_verified", payload: { method: "callback", verifiedBy: "u_ctrl" } }));
    expect(await verifyAggregate("vendor", id)).toEqual({ valid: true, length: 3 });
  });
});

describe("concurrency conflict", () => {
  it("rejects a stale expectedSeq", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused", expectedSeq: 0 }));
    // Next is 1; a writer that still thinks 0 is free must be rejected.
    await expect(
      appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", expectedSeq: 0 })),
    ).rejects.toBeInstanceOf(SequenceConflictError);
    // Correct expectedSeq succeeds.
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", expectedSeq: 1 }));
    expect((await readAggregate("invoice", id)).length).toBe(2);
  });

  it("never corrupts the chain under concurrent appends", async () => {
    const id = uid("inv");
    const results = await Promise.allSettled([
      appendApEvent(ev({ aggregateId: id, eventType: "invoice.override" })),
      appendApEvent(ev({ aggregateId: id, eventType: "invoice.override" })),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBeGreaterThanOrEqual(1);
    // Whoever won, the stored stream is contiguous, unique-seq'd, and verifies.
    const rows = await readAggregate("invoice", id);
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i));
    expect(new Set(rows.map((r) => r.seq)).size).toBe(rows.length);
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);
  });
});

describe("tamper detection", () => {
  it("detects an altered payload, a broken link, and a deleted row", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", payload: { field: "total", newValue: 120, reasonCode: "X" } }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B-2", total: 120, currency: "USD", auto: true } }));
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);

    // Alter a payload after the fact (simulating a malicious UPDATE).
    await db.execute({ sql: `UPDATE ap_events SET payload = ? WHERE aggregate_id = ? AND seq = 1`, args: [JSON.stringify({ field: "total", newValue: 999999, reasonCode: "X" }), id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, brokenAt: 1, reason: "seal_mismatch" });
  });

  it("detects a broken seal_prev link", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    await db.execute({ sql: `UPDATE ap_events SET seal_prev = 'forged' WHERE aggregate_id = ? AND seq = 1`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, brokenAt: 1, reason: "broken_seal_link" });
  });

  it("detects a gap from a deleted row (non-contiguous sequence)", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.override" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    await db.execute({ sql: `DELETE FROM ap_events WHERE aggregate_id = ? AND seq = 1`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, brokenAt: 1, reason: "non_contiguous_sequence" });
  });
});

describe("keyed seal + tail-truncation anchor", () => {
  it("seals new events at version 2 and verifies", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    const rows = await readAggregate("invoice", id);
    expect(rows.every((r) => r.sealVersion === 2)).toBe(true);
    // A v2 seal is a keyed HMAC, not the public sha256 of the envelope, so it's a
    // 64-hex digest AND (proven below) can't be recomputed without the key.
    expect(rows[0].seal).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyAggregate("invoice", id)).toEqual({ valid: true, length: 2 });
  });

  it("detects a truncated tail (which the backward seal-chain alone cannot)", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", payload: { field: "total", newValue: 1, reasonCode: "X" } }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);

    // Drop the highest-seq row. The remaining 0..1 are still contiguous with intact
    // seal links, so the chain alone looks fine — the head anchor catches it.
    await db.execute({ sql: `DELETE FROM ap_events WHERE aggregate_id = ? AND seq = 2`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "truncated_tail" });
  });

  it("detects deletion of the head anchor on a v2 chain", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);

    await db.execute({ sql: `DELETE FROM ap_aggregate_head WHERE aggregate_id = ?`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "missing_head" });
  });

  it("detects a forged head_mac (recomputing it needs the seal key)", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    // Attacker deletes the tail AND tries to fake a matching head with a guessed mac.
    await db.execute({ sql: `DELETE FROM ap_events WHERE aggregate_id = ? AND seq = 1`, args: [id] });
    await db.execute({ sql: `UPDATE ap_aggregate_head SET seq_count = 1, head_mac = 'forged' WHERE aggregate_id = ?`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "truncated_tail" });
  });

  it("defeats a seal-version DOWNGRADE (rewrite payload, reseal keyless v1, drop head)", async () => {
    // The v2 keyed HMAC can't be forged without the server secret — but v1 is a
    // KEYLESS sha256 any DB-writer can recompute. An attacker rewrites a sealed
    // amount, relabels the row seal_version=1, recomputes a valid keyless seal, and
    // deletes the head anchor to shed the truncation check. The mandatory head
    // anchor must catch this (regression for the seal-downgrade bug).
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 100, currency: "USD", auto: true } }));
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);

    const rows = await readAggregate("invoice", id);
    const tail = rows[rows.length - 1];
    const forgedPayload = { ...tail.payload, total: 999999 };
    // Reproduce the production v1 seal EXACTLY: keyless sha256 over the canonical
    // envelope (workspace_id is intentionally NOT bound in v1).
    const v1seal = createHash("sha256")
      .update(
        canonicalize({
          id: tail.id, aggregateType: tail.aggregateType, aggregateId: tail.aggregateId, seq: tail.seq,
          eventType: tail.eventType, eventVersion: tail.eventVersion, payload: forgedPayload, actor: tail.actor,
          createdAt: tail.createdAt, sealPrev: tail.sealPrev,
        }),
      )
      .digest("hex");
    await db.execute({
      sql: `UPDATE ap_events SET payload = ?, seal = ?, seal_version = 1 WHERE aggregate_id = ? AND seq = ?`,
      args: [JSON.stringify(forgedPayload), v1seal, id, tail.seq],
    });
    await db.execute({ sql: `DELETE FROM ap_aggregate_head WHERE aggregate_id = ?`, args: [id] });

    // The per-row seal now recomputes cleanly (keyless), so ONLY the mandatory head
    // anchor stands between the attacker and a forged "valid" verdict.
    const res = await verifyAggregate("invoice", id);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("missing_head");
  });

  it("backfills a keyed head for a legacy pre-anchor chain, restoring verifiability", async () => {
    // Rows migrated from a pre-anchor table have no head. backfillMissingHeads must
    // give them a keyed head so they verify — WITHOUT that, the now-mandatory head
    // check would flag genuine legacy data as tampered.
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 5, currency: "USD", auto: true } }));
    // Simulate "legacy, no anchor".
    await db.execute({ sql: `DELETE FROM ap_aggregate_head WHERE aggregate_id = ?`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "missing_head" });

    await backfillMissingHeads();
    expect(await verifyAggregate("invoice", id)).toEqual({ valid: true, length: 2 });
  });

  it("a downgraded + de-headed chain stays missing_head — runtime NEVER re-mints a head", async () => {
    // The security crux across four iterations of this fix: there is NO runtime path
    // (no boot backfill, no marker, no data-derived gate) that re-mints a head from
    // the mutable event rows — because a DB-write attacker controls every input to
    // any such condition. The head can only be minted by a genuine appendApEvent (or
    // an explicit OFFLINE operator migration). So a chain the attacker downgraded to
    // keyless v1 and de-headed is missing_head, and STAYS missing_head, permanently.
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 100, currency: "USD", auto: true } }));

    const rows = await readAggregate("invoice", id);
    const tail = rows[rows.length - 1];
    const forged = { ...tail.payload, total: 999999 };
    const v1seal = createHash("sha256")
      .update(
        canonicalize({
          id: tail.id, aggregateType: tail.aggregateType, aggregateId: tail.aggregateId, seq: tail.seq,
          eventType: tail.eventType, eventVersion: tail.eventVersion, payload: forged, actor: tail.actor,
          createdAt: tail.createdAt, sealPrev: tail.sealPrev,
        }),
      )
      .digest("hex");
    await db.execute({
      sql: `UPDATE ap_events SET payload = ?, seal = ?, seal_version = 1 WHERE aggregate_id = ? AND seq = ?`,
      args: [JSON.stringify(forged), v1seal, id, tail.seq],
    });
    await db.execute({ sql: `DELETE FROM ap_aggregate_head WHERE aggregate_id = ?`, args: [id] });
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "missing_head" });

    // Re-running the schema ensure (what a cold start does) must NOT re-anchor it.
    await ensureApEventsSchema();
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "missing_head" });
  });

  it("a later legitimate append can't LAUNDER a tampered prior row into valid", async () => {
    // The subtle oracle: appendApEvent re-mints the head over the current chain. If an
    // attacker downgrades a prior row to keyless v1 (stale head → truncated_tail), the
    // NEXT ordinary append (e.g. a reviewer's override) must NOT recompute a fresh head
    // over the forged chain and flip it back to valid. append must refuse to extend a
    // chain whose stored head doesn't already match its rows.
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused", payload: { amount: 1842 } }));
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);

    // Attacker downgrades seq0 to a keyless v1 seal over a forged amount.
    const [row0] = await readAggregate("invoice", id);
    const forged = { ...row0.payload, amount: 999999 };
    const v1seal = createHash("sha256")
      .update(
        canonicalize({
          id: row0.id, aggregateType: row0.aggregateType, aggregateId: row0.aggregateId, seq: row0.seq,
          eventType: row0.eventType, eventVersion: row0.eventVersion, payload: forged, actor: row0.actor,
          createdAt: row0.createdAt, sealPrev: row0.sealPrev,
        }),
      )
      .digest("hex");
    await db.execute({
      sql: `UPDATE ap_events SET payload = ?, seal = ?, seal_version = 1 WHERE aggregate_id = ? AND seq = 0`,
      args: [JSON.stringify(forged), v1seal, id],
    });
    // Stale head still catches it at this point.
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "truncated_tail" });

    // The next legitimate append must be REFUSED, not launder the forgery.
    await expect(
      appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", payload: { field: "review", newValue: "cleared", reasonCode: "X" } })),
    ).rejects.toBeInstanceOf(HeadIntegrityError);

    // Still not valid — the forged amount was never blessed.
    expect((await verifyAggregate("invoice", id)).valid).toBe(false);
  });

  it("a stale-tail append (concurrency/truncation) is a SequenceConflict, not HeadIntegrity", async () => {
    // The head-integrity check must NOT misfire on a legitimate concurrent append: when
    // our tail read is stale relative to a committed head (seqCount != seq), that's a
    // sequence conflict the callers already handle (retry / in_progress) — not tamper.
    // Simulate it via a truncation that leaves the head ahead of the tail.
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: true } }));
    // Drop the tail row but leave the head anchored at seq_count=2.
    await db.execute({ sql: `DELETE FROM ap_events WHERE aggregate_id = ? AND seq = 1`, args: [id] });

    // The next append computes seq=1 while the head still says 2 → SequenceConflict.
    await expect(
      appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", payload: { field: "review", newValue: "cleared", reasonCode: "X" } })),
    ).rejects.toBeInstanceOf(SequenceConflictError);
  });
});

describe("reset invariant (clearing events alone strands the head anchor)", () => {
  it("a reseed after deleting ONLY events fails verify; deleting the head too fixes it", async () => {
    const id = uid("inv");
    // Full lifecycle → head anchored at seq_count = 3.
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused" }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.override", payload: { field: "review", newValue: "cleared", reasonCode: "X" } }));
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B", total: 1, currency: "USD", auto: false } }));
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);

    // The OLD reset deleted only ap_events. The head upsert only ever advances
    // (never shrinks), so it stays pinned at 3 and the 1-event reseed reads as a
    // truncated tail — the demo would falsely report itself "altered".
    await db.execute({ sql: `DELETE FROM ap_events WHERE aggregate_id = ?`, args: [id] });
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused", id: `evt_${id}_reseed1` }));
    expect(await verifyAggregate("invoice", id)).toMatchObject({ valid: false, reason: "truncated_tail" });

    // The FIXED reset also clears the head anchor, so the reseed re-anchors cleanly.
    await db.execute({ sql: `DELETE FROM ap_events WHERE aggregate_id = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM ap_aggregate_head WHERE aggregate_id = ?`, args: [id] });
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.review_paused", id: `evt_${id}_reseed2` }));
    expect(await verifyAggregate("invoice", id)).toEqual({ valid: true, length: 1 });
  });
});

describe("backward-compatible event versioning", () => {
  it("upcasts a v1 invoice.submitted payload (amount → total) on read, and still verifies", async () => {
    const id = uid("inv");
    // Historical v1 event: payload used `amount` before the rename to `total`.
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", eventVersion: 1, payload: { billNumber: "B-old", amount: 500, currency: "USD", auto: true } }));

    const raw = await readAggregate("invoice", id);
    expect(raw[0].eventVersion).toBe(1);
    expect(raw[0].payload).toMatchObject({ amount: 500 });
    expect(raw[0].payload.total).toBeUndefined();

    const loaded = await loadAggregate("invoice", id);
    expect(loaded[0].eventVersion).toBe(2);
    expect(loaded[0].payload).toMatchObject({ total: 500, billNumber: "B-old" });
    expect(loaded[0].payload.amount).toBeUndefined();

    // Upcasting is a read-time view; the stored v1 seal is untouched.
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);
  });

  it("passes a current-version payload through unchanged", async () => {
    const id = uid("inv");
    await appendApEvent(ev({ aggregateId: id, eventType: "invoice.submitted", payload: { billNumber: "B-new", total: 700, currency: "USD", auto: false } }));
    const loaded = await loadAggregate("invoice", id);
    expect(loaded[0].eventVersion).toBe(2);
    expect(loaded[0].payload).toMatchObject({ total: 700 });
  });
});
