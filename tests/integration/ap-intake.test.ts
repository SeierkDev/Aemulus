import { beforeAll, describe, it, expect } from "vitest";
import { db } from "../../lib/db";
import { ensureQboConnectionSchema } from "../../lib/qbo/oauth";
import { intakeEnter } from "../../lib/ap-controls/intake";
import { loadAggregate } from "../../lib/ap-controls/store";
import { projectInvoiceEntry } from "../../lib/ap-controls/projections";
import { listLedgerBills, type LedgerBill } from "../../lib/ap-controls/ledger";
import type { InvoiceReceivedPayload } from "../../lib/ap-controls/store";

const NOW = 1_700_000_000_000;
const find = (bills: LedgerBill[], n: string) => bills.find((b) => b.billNumber === n);

beforeAll(async () => {
  await ensureQboConnectionSchema();
  // No QuickBooks connection → intake enters the built-in ledger.
  await db.execute({ sql: `DELETE FROM qbo_connection WHERE id = 'default'` });
});

describe("invoice intake", () => {
  it("enters an extracted invoice to the ledger, sealed with provenance", async () => {
    const r = await intakeEnter(
      { vendor: "Globex Corp", invoiceNumber: "GX-2025-77", invoiceDate: "2025-06-01", amount: 743.2, currency: "usd" },
      "upload",
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe("ledger");
    expect(r.billNumber).toMatch(/^AEM-\d+$/);
    expect(r.verify.valid).toBe(true);
    expect(r.verify.length).toBe(2); // received + submitted

    const state = await projectInvoiceEntry(r.invoiceId);
    expect(state.status).toBe("submitted");
    expect(state.billNumber).toBe(r.billNumber);

    // Provenance is sealed into the audit stream.
    const events = await loadAggregate("invoice", r.invoiceId);
    const received = events.find((e) => e.eventType === "invoice.received");
    expect(received).toBeTruthy();
    expect((received!.payload as unknown as InvoiceReceivedPayload).vendor).toBe("Globex Corp");
    expect((received!.payload as unknown as InvoiceReceivedPayload).source).toBe("upload");

    // Real ledger bill, currency normalized.
    const bill = find(await listLedgerBills(), r.billNumber);
    expect(bill?.vendor).toBe("Globex Corp");
    expect(bill?.currency).toBe("USD");
    expect(bill?.amount).toBe(743.2);
  });

  it("fills safe defaults for missing fields", async () => {
    const r = await intakeEnter(
      { vendor: "", invoiceNumber: "", invoiceDate: "not-a-date", amount: 10, currency: "" },
      "upload",
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bill = find(await listLedgerBills(), r.billNumber);
    expect(bill?.vendor).toBe("Unknown vendor");
    expect(bill?.docNumber).toMatch(/^UPLOAD-inv_/);
    expect(bill?.currency).toBe("USD");
  });
});
