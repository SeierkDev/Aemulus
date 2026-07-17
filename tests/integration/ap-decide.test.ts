import { beforeAll, describe, it, expect } from "vitest";
import { db } from "../../lib/db";
import { ensureQboConnectionSchema } from "../../lib/qbo/oauth";
import { appendApEvent, verifyAggregate } from "../../lib/ap-controls/store";
import { projectInvoiceEntry, liveInvoiceQueueAll } from "../../lib/ap-controls/projections";
import { decideInvoice } from "../../lib/ap-controls/decide";

const NOW = 1_700_000_000_000;
let n = 0;
const uid = () => `ap_dec_${++n}`;
const ACTOR = { userId: "u_jane", role: "clerk" as const };

async function seedReview(id: string) {
  await appendApEvent({
    aggregateType: "invoice", aggregateId: id, eventType: "invoice.review_paused",
    payload: { reasonCodes: ["NEW_VENDOR"], topReasonCode: "NEW_VENDOR", banner: "held", amount: 88.75, currency: "USD", vendor: "Fabrikam Inc", requiresSecondApproval: false },
    actor: { userId: "system", role: "system" }, now: NOW, id: `${id}_p`,
  });
}
const decide = (id: string, action: "approve" | "reject", reasonCode: string, canEnter = true) =>
  decideInvoice({ invoiceId: id, workspaceId: "default", actor: ACTOR, action, reasonCode, canEnter, now: NOW });
const inQueue = async (id: string) => (await liveInvoiceQueueAll()).some((q) => q.invoiceId === id);

beforeAll(async () => {
  await ensureQboConnectionSchema();
  await db.execute({ sql: `DELETE FROM qbo_connection WHERE id = 'default'` }); // ledger path
});

describe("decideInvoice", () => {
  it("approves → seals an override + enters, and leaves the queue", async () => {
    const id = uid();
    await seedReview(id);
    expect(await inQueue(id)).toBe(true);

    const r = await decide(id, "approve", "LEGITIMATE");
    expect(r.ok).toBe(true);
    if (!r.ok || r.status !== "submitted") return;
    expect(String(r.billNumber)).toMatch(/^AEM-\d+$/);
    expect(r.verify).toEqual({ valid: true, length: 3 }); // paused + override + submitted

    expect((await projectInvoiceEntry(id)).status).toBe("submitted");
    expect(await inQueue(id)).toBe(false);
  });

  it("rejects → seals a rejection and leaves the queue", async () => {
    const id = uid();
    await seedReview(id);

    const r = await decide(id, "reject", "DUPLICATE");
    expect(r).toEqual({ ok: true, status: "rejected" });

    expect((await projectInvoiceEntry(id)).status).toBe("rejected");
    expect((await verifyAggregate("invoice", id)).valid).toBe(true);
    expect(await inQueue(id)).toBe(false);
  });

  it("refuses a missing reason (400), a second decision (409), and being over-limit", async () => {
    const id = uid();
    await seedReview(id);
    expect(await decide(id, "approve", "")).toMatchObject({ ok: false, httpStatus: 400 });
    expect(await decide(id, "approve", "LEGITIMATE", false)).toMatchObject({ ok: false, error: "limit_reached", httpStatus: 400 });
    await decide(id, "reject", "NOT_OURS");
    expect(await decide(id, "approve", "LEGITIMATE")).toMatchObject({ ok: false, httpStatus: 409 });
  });
});
