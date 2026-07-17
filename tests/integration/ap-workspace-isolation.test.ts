import { describe, it, expect } from "vitest";
import { appendApEvent, loadAggregate } from "../../lib/ap-controls/store";
import { liveInvoiceQueueAll, projectInvoiceEntry } from "../../lib/ap-controls/projections";
import { enterInvoice } from "../../lib/ap-controls/qbo-submit";
import { listLedgerBills } from "../../lib/ap-controls/ledger";
import { seedApDemo, DEMO_INVOICE_ID } from "../../lib/ap-controls/demo";

const NOW = 1_700_000_000_000;
const wsA = "usr_isoA";
const wsB = "usr_isoB";
const SYS = { userId: "system", role: "system" };

async function flag(ws: string, id: string, vendor: string) {
  await appendApEvent({
    workspaceId: ws, aggregateType: "invoice", aggregateId: id, eventType: "invoice.review_paused",
    payload: { reasonCodes: ["NEW_VENDOR"], topReasonCode: "NEW_VENDOR", banner: "held", amount: 100, currency: "USD", vendor, requiresSecondApproval: false },
    actor: SYS, now: NOW, id: `${id}_${ws}_p`,
  });
}

describe("workspace data isolation", () => {
  it("queues, ledgers, and streams are scoped per workspace", async () => {
    await flag(wsA, "inv_isoA1", "Acme A");
    await flag(wsB, "inv_isoB1", "Beta B");

    const idsA = (await liveInvoiceQueueAll(wsA)).map((q) => q.invoiceId);
    const idsB = (await liveInvoiceQueueAll(wsB)).map((q) => q.invoiceId);
    expect(idsA).toContain("inv_isoA1");
    expect(idsA).not.toContain("inv_isoB1");
    expect(idsB).toContain("inv_isoB1");
    expect(idsB).not.toContain("inv_isoA1");

    // Enter A's invoice into A's ledger; B's ledger is untouched.
    const r = await enterInvoice({
      invoiceId: "inv_isoA1", vendorName: "Acme A", docNumber: "A1", txnDate: "2025-01-01",
      amount: 100, total: 100, currency: "USD", actor: SYS, now: NOW, workspaceId: wsA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe("ledger");
    expect((await listLedgerBills(50, wsA)).some((b) => b.billNumber === r.billNumber)).toBe(true);
    expect((await listLedgerBills(50, wsB)).some((b) => b.billNumber === r.billNumber)).toBe(false);

    // A's stream is invisible from B.
    expect((await loadAggregate("invoice", "inv_isoA1", wsB)).length).toBe(0);
    expect((await projectInvoiceEntry("inv_isoA1", wsB)).status).toBe("new");
    expect((await projectInvoiceEntry("inv_isoA1", wsA)).status).toBe("submitted");
  });

  it("the same aggregate id in two workspaces is two independent sealed streams", async () => {
    await seedApDemo(wsA);
    await seedApDemo(wsB);
    const a = await loadAggregate("invoice", DEMO_INVOICE_ID, wsA);
    const b = await loadAggregate("invoice", DEMO_INVOICE_ID, wsB);
    // No UNIQUE(aggregate, seq) collision across workspaces — both seed at seq 0.
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].seq).toBe(0);
    expect(b[0].seq).toBe(0);
    expect((await projectInvoiceEntry(DEMO_INVOICE_ID, wsA)).status).toBe("needs_review");
    expect((await projectInvoiceEntry(DEMO_INVOICE_ID, wsB)).status).toBe("needs_review");
  });
});
