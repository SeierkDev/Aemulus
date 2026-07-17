import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature, applyStripeEvent } from "../../lib/ap-controls/stripe";
import { getPlan } from "../../lib/ap-controls/billing";

const NOW = 1_700_000_000_000;
const nowSec = 1_700_000_000;
const secret = "whsec_test";
const sign = (payload: string, s: string, t: number) => `t=${t},v1=${createHmac("sha256", s).update(`${t}.${payload}`).digest("hex")}`;

describe("stripe webhook signature", () => {
  it("accepts a valid signature", () => {
    const payload = '{"hello":"world"}';
    expect(verifyStripeSignature(payload, sign(payload, secret, nowSec), secret, nowSec)).toBe(true);
  });
  it("rejects tampered payload, wrong secret, stale timestamp, and missing header", () => {
    const payload = '{"a":1}';
    const sig = sign(payload, secret, nowSec);
    expect(verifyStripeSignature('{"a":2}', sig, secret, nowSec)).toBe(false);
    expect(verifyStripeSignature(payload, sig, "whsec_other", nowSec)).toBe(false);
    expect(verifyStripeSignature(payload, sig, secret, nowSec + 10_000)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret, nowSec)).toBe(false);
  });
});

describe("stripe event application", () => {
  it("checkout completed → pro; subscription deleted → free", async () => {
    const ws = "usr_stripe1";
    await applyStripeEvent({ type: "checkout.session.completed", data: { object: { client_reference_id: ws, customer: "cus_x", subscription: "sub_x" } } }, NOW);
    const pro = await getPlan(ws);
    expect(pro.plan).toBe("pro");
    expect(pro.stripeCustomerId).toBe("cus_x");

    await applyStripeEvent({ type: "customer.subscription.deleted", data: { object: { metadata: { workspace_id: ws } } } }, NOW);
    expect((await getPlan(ws)).plan).toBe("free");
  });

  it("subscription updated to a non-active status downgrades", async () => {
    const ws = "usr_stripe2";
    await applyStripeEvent({ type: "checkout.session.completed", data: { object: { client_reference_id: ws, subscription: "sub_y" } } }, NOW);
    expect((await getPlan(ws)).plan).toBe("pro");
    await applyStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_y", status: "past_due", metadata: { workspace_id: ws } } } }, NOW);
    expect((await getPlan(ws)).plan).toBe("free");
  });
});
