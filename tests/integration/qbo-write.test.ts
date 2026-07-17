import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { db } from "../../lib/db";
import { startQboStandIn, type QboStandIn } from "../helpers/qbo-stand-in";
import { writeInvoiceToQbo, readQboWrite, ensureQboSchema } from "../../lib/qbo/write";

const NOW = 1_700_000_000_000;
let qbo: QboStandIn;
let n = 0;
const uid = () => `inv_${++n}`;

beforeAll(async () => {
  qbo = await startQboStandIn();
  await ensureQboSchema();
});
afterAll(async () => {
  await qbo.close();
});

function cfg() {
  return { base: qbo.url, realm: qbo.realm, token: "valid" };
}
function write(invoiceId: string, docNumber: string, vendorName = "Acme Corp", now = NOW) {
  return writeInvoiceToQbo({ invoiceId, docNumber, vendorName, txnDate: "2025-04-17", amount: 1842, config: cfg(), now });
}
const billsFor = (doc: string) => qbo.bills().filter((b) => b.DocNumber === doc).length;

describe("writeInvoiceToQbo", () => {
  it("posts a Bill and records it", async () => {
    const id = uid();
    const doc = `D-${id}`;
    const r = await write(id, doc);
    expect(r.status).toBe("posted");
    expect((r as { billId: string }).billId).toMatch(/^\d+$/);
    expect(billsFor(doc)).toBe(1);
    expect(await readQboWrite(id)).toMatchObject({ status: "posted" });
  });

  it("is idempotent — re-submitting the same invoice creates no second Bill", async () => {
    const id = uid();
    const doc = `D-${id}`;
    const first = await write(id, doc);
    const second = await write(id, doc);
    expect(first.status).toBe("posted");
    expect(second).toMatchObject({ status: "posted", alreadyPosted: true });
    expect(billsFor(doc)).toBe(1);
  });

  it("never double-posts under concurrent writes", async () => {
    const id = uid();
    const doc = `D-${id}`;
    const results = await Promise.all([write(id, doc), write(id, doc), write(id, doc)]);
    expect(results.every((r) => r.status === "posted" || r.status === "in_progress")).toBe(true);
    expect(billsFor(doc)).toBe(1);
    expect(await readQboWrite(id)).toMatchObject({ status: "posted" });
  });

  it("fails cleanly on an unknown vendor and creates no Bill, then a retry with a known vendor posts it", async () => {
    const id = uid();
    const doc = `D-${id}`;
    const failed = await write(id, doc, "Ghost Corp");
    expect(failed).toMatchObject({ status: "failed", error: "vendor_not_found" });
    expect(billsFor(doc)).toBe(0);
    expect(await readQboWrite(id)).toMatchObject({ status: "failed" });

    const retry = await write(id, doc, "Acme Corp");
    expect(retry.status).toBe("posted");
    expect(billsFor(doc)).toBe(1);
  });

  it("returns in_progress for a fresh pending claim (a concurrent owner) — no Bill", async () => {
    const id = uid();
    const doc = `D-${id}`;
    await db.execute({
      sql: `INSERT INTO qbo_write (invoice_id, status, doc_number, attempts, created_at, updated_at) VALUES (?, 'pending', ?, 1, ?, ?)`,
      args: [id, doc, NOW, NOW],
    });
    const r = await write(id, doc, "Acme Corp", NOW);
    expect(r.status).toBe("in_progress");
    expect(billsFor(doc)).toBe(0);
  });

  it("reclaims a stale pending claim (crash recovery) and posts", async () => {
    const id = uid();
    const doc = `D-${id}`;
    await db.execute({
      sql: `INSERT INTO qbo_write (invoice_id, status, doc_number, attempts, created_at, updated_at) VALUES (?, 'pending', ?, 1, ?, ?)`,
      args: [id, doc, NOW - 600_000, NOW - 600_000],
    });
    const r = await write(id, doc, "Acme Corp", NOW);
    expect(r.status).toBe("posted");
    expect(billsFor(doc)).toBe(1);
  });
});
