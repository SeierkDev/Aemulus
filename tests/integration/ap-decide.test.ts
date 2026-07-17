import { beforeAll, describe, it, expect } from "vitest";
import { db } from "../../lib/db";
import { ensureQboConnectionSchema } from "../../lib/qbo/oauth";
import { appendApEvent, verifyAggregate } from "../../lib/ap-controls/store";
import { projectInvoiceEntry, liveInvoiceQueueAll } from "../../lib/ap-controls/projections";
import { POST } from "../../app/api/ap/[id]/decide/route";
import { DEMO_INVOICE_ID } from "../../lib/ap-controls/demo";

const NOW = 1_700_000_000_000;
let n = 0;
const uid = () => `ap_dec_${++n}`;

async function seedReview(id: string) {
  await appendApEvent({
    aggregateType: "invoice", aggregateId: id, eventType: "invoice.review_paused",
    payload: { reasonCodes: ["NEW_VENDOR"], topReasonCode: "NEW_VENDOR", banner: "held", amount: 88.75, currency: "USD", vendor: "Fabrikam Inc", requiresSecondApproval: false },
    actor: { userId: "system", role: "system" }, now: NOW, id: `${id}_p`,
  });
}
async function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/ap/${id}/decide`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const inQueue = async (id: string) => (await liveInvoiceQueueAll()).some((q) => q.invoiceId === id);

beforeAll(async () => {
  await ensureQboConnectionSchema();
  await db.execute({ sql: `DELETE FROM qbo_connection WHERE id = 'default'` }); // ledger path
});

describe("generic invoice decision", () => {
  it("approves → seals an override + enters, and leaves the queue", async () => {
    const id = uid();
    await seedReview(id);
    expect(await inQueue(id)).toBe(true);

    const { json } = await call(id, { action: "approve", reasonCode: "LEGITIMATE" });
    expect(json.ok).toBe(true);
    expect(json.status).toBe("submitted");
    expect(String(json.billNumber)).toMatch(/^AEM-\d+$/);
    expect(json.verify).toEqual({ valid: true, length: 3 }); // paused + override + submitted

    expect((await projectInvoiceEntry(id)).status).toBe("submitted");
    expect(await inQueue(id)).toBe(false);
  });

  it("rejects → seals a rejection and leaves the queue", async () => {
    const id = uid();
    await seedReview(id);

    const { json } = await call(id, { action: "reject", reasonCode: "DUPLICATE" });
    expect(json.ok).toBe(true);
    expect(json.status).toBe("rejected");

    const state = await projectInvoiceEntry(id);
    expect(state.status).toBe("rejected");
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);
    expect(await inQueue(id)).toBe(false);
  });

  it("refuses a second decision (409) and a missing reason (400)", async () => {
    const id = uid();
    await seedReview(id);
    expect((await call(id, { action: "approve", reasonCode: "" })).status).toBe(400);
    await call(id, { action: "reject", reasonCode: "NOT_OURS" });
    expect((await call(id, { action: "approve", reasonCode: "LEGITIMATE" })).status).toBe(409);
  });

  it("does not handle the demo invoice (404)", async () => {
    expect((await call(DEMO_INVOICE_ID, { action: "approve", reasonCode: "LEGITIMATE" })).status).toBe(404);
  });
});
