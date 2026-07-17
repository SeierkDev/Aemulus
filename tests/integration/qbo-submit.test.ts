import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { db } from "../../lib/db";
import { startQboStandIn, type QboStandIn } from "../helpers/qbo-stand-in";
import { exchangeCode, ensureQboConnectionSchema } from "../../lib/qbo/oauth";
import { appendApEvent } from "../../lib/ap-controls/store";
import { projectInvoiceEntry } from "../../lib/ap-controls/projections";
import { enterInvoice } from "../../lib/ap-controls/qbo-submit";
import { listLedgerBills } from "../../lib/ap-controls/ledger";

const NOW = 1_700_000_000_000;
let qbo: QboStandIn;
let n = 0;
const uid = () => `inv_sub_${++n}`;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };

const ACTOR = { userId: "u_jane", role: "clerk" };

async function seedInvoice(id: string) {
  await appendApEvent({
    aggregateType: "invoice", aggregateId: id, eventType: "invoice.review_paused",
    payload: { reasonCodes: ["DUPLICATE"], topReasonCode: "DUPLICATE", banner: "held", amount: 1842, currency: "USD", vendor: "Acme Corp", requiresSecondApproval: false },
    actor: { userId: "system", role: "system" }, now: NOW, id: `${id}_p`,
  });
  await appendApEvent({
    aggregateType: "invoice", aggregateId: id, eventType: "invoice.override",
    payload: { type: "duplicate", field: "duplicate", originalValue: "flagged", newValue: "cleared", reasonCode: "LEGIT_REBILL" },
    actor: ACTOR, now: NOW + 1, id: `${id}_o`,
  });
}
function input(id: string) {
  return {
    invoiceId: id, vendorName: "Acme Corp", docNumber: `INV-SUB-${id}`,
    txnDate: "2025-04-17", amount: 1842, total: 1842, currency: "USD", actor: ACTOR, now: NOW,
  };
}
const billsFor = (doc: string) => qbo.bills().filter((b) => b.DocNumber === doc).length;

beforeAll(async () => {
  qbo = await startQboStandIn();
  setEnv("QBO_CLIENT_ID", "client-abc");
  setEnv("QBO_CLIENT_SECRET", "secret-xyz");
  setEnv("QBO_REDIRECT_URI", "http://localhost:3000/api/qbo/callback");
  setEnv("QBO_TOKEN_URL", `${qbo.url}/oauth2/v1/tokens/bearer`);
  setEnv("QBO_BASE", qbo.url);
  await ensureQboConnectionSchema();
  await db.execute({ sql: `DELETE FROM qbo_connection WHERE id='default'` });
  await exchangeCode("auth-code", "realm-x", NOW); // establish a connection at the stand-in
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await qbo.close();
});

describe("enterInvoice (submit → QBO → seal)", () => {
  it("posts to QuickBooks and seals the real Bill id into the audit stream", async () => {
    const id = uid();
    const doc = `INV-SUB-${id}`;
    await seedInvoice(id);

    const r = await enterInvoice(input(id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe("quickbooks");
    expect(r.billNumber).toMatch(/^\d+$/);
    expect(r.verify).toEqual({ valid: true, length: 3 }); // paused + override + submitted
    expect(r.seal).toBeTruthy();
    expect(billsFor(doc)).toBe(1);

    const state = await projectInvoiceEntry(id);
    expect(state.status).toBe("submitted");
    expect(state.billNumber).toBe(r.billNumber);
  });

  it("is idempotent — a second submit adds no Bill and no second event", async () => {
    const id = uid();
    const doc = `INV-SUB-${id}`;
    await seedInvoice(id);

    const first = await enterInvoice(input(id));
    const second = await enterInvoice(input(id));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.billNumber).toBe(first.billNumber);
    expect(second.verify.length).toBe(3); // still 3 events, no duplicate submitted
    expect(billsFor(doc)).toBe(1);
  });

  it("enters into the built-in ledger when QuickBooks isn't connected", async () => {
    await db.execute({ sql: `DELETE FROM qbo_connection WHERE id='default'` });
    const id = uid();
    await seedInvoice(id);

    const r = await enterInvoice(input(id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe("ledger");
    expect(r.billNumber).toMatch(/^AEM-\d+$/);
    expect(r.verify).toEqual({ valid: true, length: 3 });

    const state = await projectInvoiceEntry(id);
    expect(state.status).toBe("submitted");
    expect(state.enterTarget).toBe("ledger");
    expect((await listLedgerBills()).some((b) => b.billNumber === r.billNumber)).toBe(true);

    // Idempotent: a second enter returns the same ledger bill, no duplicate.
    const again = await enterInvoice(input(id));
    expect(again.ok && again.billNumber).toBe(r.billNumber);
    expect((await listLedgerBills()).filter((b) => b.billNumber === r.billNumber)).toHaveLength(1);
  });
});
