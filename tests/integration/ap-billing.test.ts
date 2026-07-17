import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { getPlan, setPlan, usageThisPeriod, entitlement } from "../../lib/ap-controls/billing";
import { enterInvoice } from "../../lib/ap-controls/qbo-submit";

const NOW = 1_700_000_000_000;
const SYS = { userId: "system", role: "system" };
const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) { saved[k] = process.env[k]; process.env[k] = v; }

function enter(ws: string, id: string) {
  return enterInvoice({ invoiceId: id, vendorName: "V", docNumber: id, txnDate: "2025-01-01", amount: 5, total: 5, currency: "USD", actor: SYS, now: NOW, workspaceId: ws });
}

describe("billing plans + usage", () => {
  it("defaults to free and upgrades to pro", async () => {
    const ws = "usr_bill1";
    expect((await getPlan(ws)).plan).toBe("free");
    await setPlan({ workspaceId: ws, plan: "pro", status: "active", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", now: NOW });
    const p = await getPlan(ws);
    expect(p.plan).toBe("pro");
    expect(p.stripeCustomerId).toBe("cus_1");
  });

  it("meters usage from entered invoices", async () => {
    const ws = "usr_bill2";
    expect(await usageThisPeriod(ws, NOW)).toBe(0);
    await enter(ws, "usr_bill2_a");
    await enter(ws, "usr_bill2_b");
    expect(await usageThisPeriod(ws, NOW)).toBe(2);
  });
});

describe("entitlement + enforcement (Stripe configured)", () => {
  beforeAll(() => {
    setEnv("STRIPE_SECRET_KEY", "sk_test");
    setEnv("STRIPE_PRICE_ID", "price_1");
    setEnv("STRIPE_WEBHOOK_SECRET", "whsec_1");
    setEnv("AEMULUS_FREE_ENTRY_LIMIT", "2");
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it("never enforces the shared default workspace", async () => {
    const e = await entitlement("default", NOW);
    expect(e.enforced).toBe(false);
    expect(e.canEnter).toBe(true);
  });

  it("blocks a free workspace past the limit, unblocks on Pro", async () => {
    const ws = "usr_bill3";
    expect((await enter(ws, "usr_bill3_1")).ok).toBe(true);
    expect((await enter(ws, "usr_bill3_2")).ok).toBe(true);
    expect(await enter(ws, "usr_bill3_3")).toEqual({ ok: false, error: "limit_reached" });

    await setPlan({ workspaceId: ws, plan: "pro", status: "active", now: NOW });
    const e = await entitlement(ws, NOW);
    expect(e.limit).toBeNull();
    expect((await enter(ws, "usr_bill3_4")).ok).toBe(true);
  });
});
