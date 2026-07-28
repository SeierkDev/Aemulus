import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { reserveApEntry, releaseApEntry, usageThisPeriod } from "../../lib/ap-controls/billing";
import { appendApEvent } from "../../lib/ap-controls/store";
import { DEMO_INVOICE_ID } from "../../lib/ap-controls/demo";

// The AP free-entry limit was a check-then-act (COUNT then seal on a fresh
// aggregate that never contends), so a concurrent burst could all pass. The
// reservation makes the count-and-insert one atomic statement.

beforeAll(async () => {
  await ready();
});

describe("atomic AP entry reservation", () => {
  it("caps sequential reservations at the limit, then refuses", async () => {
    const ws = "w_RESV_SEQ";
    const now = Date.now();
    expect(await reserveApEntry(ws, 2, now)).not.toBeNull();
    expect(await reserveApEntry(ws, 2, now)).not.toBeNull();
    expect(await reserveApEntry(ws, 2, now)).toBeNull(); // over the limit of 2
  });

  it("a concurrent burst can never exceed the limit", async () => {
    const ws = "w_RESV_BURST";
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reserveApEntry(ws, 3, now)),
    );
    expect(results.filter((r) => r !== null).length).toBe(3); // exactly the limit
  });

  it("releasing a reservation returns the slot (a failed entry doesn't burn quota)", async () => {
    const ws = "w_RESV_RELEASE";
    const now = Date.now();
    const r1 = await reserveApEntry(ws, 1, now);
    expect(r1).not.toBeNull();
    expect(await reserveApEntry(ws, 1, now)).toBeNull(); // at limit
    await releaseApEntry(r1 as string);
    expect(await reserveApEntry(ws, 1, now)).not.toBeNull(); // slot freed
  });

  it("is scoped per workspace", async () => {
    const now = Date.now();
    expect(await reserveApEntry("w_RESV_A", 1, now)).not.toBeNull();
    expect(await reserveApEntry("w_RESV_A", 1, now)).toBeNull(); // A at limit
    expect(await reserveApEntry("w_RESV_B", 1, now)).not.toBeNull(); // B independent
  });

  it("counts real submitted events, so unlimited-era usage isn't invisible to the cap", async () => {
    // The bug: entries made while unlimited (pre-launch / higher tier) seal events but
    // no reservation, so a later gating/tier change reset the reservation counter to 0
    // and let the cap be exceeded. reserveApEntry now counts the sealed events too.
    const ws = "w_HIST_USAGE";
    const now = Date.now();
    for (let i = 0; i < 2; i++) {
      await appendApEvent({
        workspaceId: ws, aggregateType: "invoice", aggregateId: `inv_hist_${i}`,
        eventType: "invoice.submitted", payload: { billNumber: `H${i}`, total: 1, currency: "USD", auto: false },
        actor: { userId: "u", role: "clerk" }, now, id: `evt_hist_${ws}_${i}`,
      });
    }
    // 2 historical entries already exist. With a limit of 3, only ONE more slot is left.
    const r1 = await reserveApEntry(ws, 3, now);
    expect(r1).not.toBeNull();
    expect(await reserveApEntry(ws, 3, now)).toBeNull(); // 2 events + 1 reservation = 3, at cap
  });

  it("usageThisPeriod excludes the demo invoice (the demo submit takes no reservation)", async () => {
    const ws = "w_USAGE_DEMO";
    const now = Date.now();
    // The demo submit path seals an invoice.submitted WITHOUT reserving a slot; if it
    // counted as usage, a capped workspace could enter limit+1. It must be free.
    await appendApEvent({
      workspaceId: ws, aggregateType: "invoice", aggregateId: DEMO_INVOICE_ID,
      eventType: "invoice.submitted", payload: { billNumber: "D", total: 1, currency: "USD", auto: false },
      actor: { userId: "u", role: "clerk" }, now, id: `evt_demo_${ws}`,
    });
    expect(await usageThisPeriod(ws, now)).toBe(0); // demo doesn't count
    // A real invoice submission DOES count.
    await appendApEvent({
      workspaceId: ws, aggregateType: "invoice", aggregateId: "inv_real_1",
      eventType: "invoice.submitted", payload: { billNumber: "R", total: 5, currency: "USD", auto: false },
      actor: { userId: "u", role: "clerk" }, now, id: `evt_real_${ws}`,
    });
    expect(await usageThisPeriod(ws, now)).toBe(1); // only the real one
  });
});
