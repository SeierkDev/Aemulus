import { beforeAll, describe, it, expect } from "vitest";
import { db, ready } from "../../lib/db";
import {
  appendApEvent,
  readAggregate,
  loadAggregate,
  verifyAggregate,
  SequenceConflictError,
  type AppendInput,
} from "../../lib/ap-controls/store";

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
    expect(rows[0].sealPrev).toBe(`genesis:default:invoice:${id}`);
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
