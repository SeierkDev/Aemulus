import { createHmac, timingSafeEqual } from "node:crypto";
import { setPlan } from "./billing";

// Stripe integration without the SDK — Checkout via the REST API and webhook
// verification via HMAC. Inert unless STRIPE_* env vars are set (see billing.ts).

const STRIPE_API = "https://api.stripe.com/v1";

export interface CheckoutInput {
  workspaceId: string;
  email: string;
  origin: string;
}

/** Create a subscription Checkout Session and return its hosted URL. */
export async function createCheckoutSession(input: CheckoutInput): Promise<string> {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const price = process.env.STRIPE_PRICE_ID ?? "";
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("line_items[0][price]", price);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", `${input.origin}/ap/billing?upgraded=1`);
  body.set("cancel_url", `${input.origin}/ap/billing`);
  body.set("client_reference_id", input.workspaceId);
  if (input.email) body.set("customer_email", input.email);
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("subscription_data[metadata][workspace_id]", input.workspaceId);

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`stripe_checkout_${res.status}`);
  const j = (await res.json()) as { url?: string };
  if (!j.url) throw new Error("stripe_no_url");
  return j.url;
}

/** Verify a Stripe webhook signature (t=<ts>,v1=<hmac>) within a tolerance. */
export function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): boolean {
  if (!sigHeader) return false;
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function metaWorkspace(obj: Record<string, unknown>): string {
  const meta = obj.metadata as Record<string, unknown> | undefined;
  return str(obj.client_reference_id ?? meta?.workspace_id);
}

/** Apply a verified Stripe event to the workspace's plan. */
export async function applyStripeEvent(event: StripeEvent, now: number): Promise<void> {
  const obj = event.data.object;
  if (event.type === "checkout.session.completed") {
    const workspaceId = metaWorkspace(obj);
    if (!workspaceId) return;
    await setPlan({
      workspaceId, plan: "pro", status: "active",
      stripeCustomerId: obj.customer ? str(obj.customer) : null,
      stripeSubscriptionId: obj.subscription ? str(obj.subscription) : null,
      currentPeriodEnd: null, now,
    });
  } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const workspaceId = metaWorkspace(obj);
    if (!workspaceId) return;
    const status = str(obj.status);
    const active = status === "active" || status === "trialing";
    await setPlan({
      workspaceId, plan: active ? "pro" : "free", status,
      stripeSubscriptionId: str(obj.id),
      currentPeriodEnd: obj.current_period_end ? Number(obj.current_period_end) * 1000 : null,
      now,
    });
  } else if (event.type === "customer.subscription.deleted") {
    const workspaceId = metaWorkspace(obj);
    if (!workspaceId) return;
    await setPlan({ workspaceId, plan: "free", status: "canceled", currentPeriodEnd: null, now });
  }
}
