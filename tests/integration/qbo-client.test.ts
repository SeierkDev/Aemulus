import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { startQboStandIn, type QboStandIn } from "../helpers/qbo-stand-in";
import { qboClient, QboError } from "../../lib/qbo/client";

let qbo: QboStandIn;

beforeAll(async () => {
  qbo = await startQboStandIn();
});
afterAll(async () => {
  await qbo.close();
});

function client(token = "valid-token") {
  return qboClient({ base: qbo.url, realm: qbo.realm, token });
}

describe("qboClient", () => {
  it("resolves vendor + expense account, creates a Bill, and reads it back", async () => {
    const c = client();
    const vendor = await c.findVendorByName("Acme Corp");
    expect(vendor?.Id).toBe("1");

    const account = await c.findExpenseAccount();
    expect(account?.AccountType).toBe("Expense");

    const bill = await c.createBill({
      vendorId: vendor!.Id,
      accountId: account!.Id,
      docNumber: "INV-2025-0417",
      txnDate: "2025-04-17",
      amount: 1842,
    });
    expect(bill.Id).toMatch(/^\d+$/);
    expect(bill.TotalAmt).toBe(1842);

    const found = await c.findBillByDocNumber("INV-2025-0417");
    expect(found?.Id).toBe(bill.Id);
    expect(qbo.bills()).toHaveLength(1);
  });

  it("returns null for an unknown vendor", async () => {
    expect(await client().findVendorByName("Nope Corp")).toBeNull();
  });

  it("throws QboError(401) on a bad token", async () => {
    await expect(client("expired").findExpenseAccount()).rejects.toBeInstanceOf(QboError);
    await expect(client("expired").findExpenseAccount()).rejects.toMatchObject({ status: 401 });
  });

  it("throws QboError(400) when the vendor id is not in QuickBooks", async () => {
    await expect(
      client().createBill({ vendorId: "999", accountId: "60", docNumber: "X-1", txnDate: "2025-01-01", amount: 5 }),
    ).rejects.toBeInstanceOf(QboError);
  });

  it("does not create a Bill on a rejected write", async () => {
    const before = qbo.bills().length;
    await client().createBill({ vendorId: "999", accountId: "60", docNumber: "X-2", txnDate: "2025-01-01", amount: 5 }).catch(() => {});
    expect(qbo.bills()).toHaveLength(before);
  });
});
