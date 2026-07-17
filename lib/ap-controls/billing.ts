import { db, ready } from "../db";
import { DEFAULT_WORKSPACE } from "./workspace";

// Per-workspace billing: a plan (free | pro), usage metering, and entitlement.
// Enforcement is INERT until Stripe is configured — with no keys the product is
// open (no limits), matching how QuickBooks stays inert until connected. Usage is
// derived from the sealed event log (invoice.submitted events), so it can't drift
// from what actually happened.

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30-day window

export function freeEntryLimit(): number {
  return Number(process.env.AEMULUS_FREE_ENTRY_LIMIT) || 10;
}

/** Billing is live only when all three Stripe secrets are present. */
export function billingConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET);
}

const DDL = `
  CREATE TABLE IF NOT EXISTS workspace_plan (
    workspace_id           TEXT PRIMARY KEY,
    plan                   TEXT NOT NULL DEFAULT 'free',
    status                 TEXT NOT NULL DEFAULT 'active',
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    current_period_end     INTEGER,
    updated_at             INTEGER NOT NULL
  )`;

let ensured: Promise<void> | null = null;
export function ensureBillingSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ready();
      await db.execute(DDL);
    })();
  }
  return ensured;
}

export type Plan = "free" | "pro";

export interface WorkspacePlan {
  plan: Plan;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: number | null;
}

export async function getPlan(workspaceId: string): Promise<WorkspacePlan> {
  await ensureBillingSchema();
  const r = await db.execute({ sql: `SELECT * FROM workspace_plan WHERE workspace_id = ?`, args: [workspaceId] });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { plan: "free", status: "active", stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null };
  return {
    plan: String(row.plan) === "pro" ? "pro" : "free",
    status: String(row.status),
    stripeCustomerId: row.stripe_customer_id == null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId: row.stripe_subscription_id == null ? null : String(row.stripe_subscription_id),
    currentPeriodEnd: row.current_period_end == null ? null : Number(row.current_period_end),
  };
}

export interface SetPlanInput {
  workspaceId: string;
  plan: Plan;
  status?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: number | null;
  now: number;
}

export async function setPlan(input: SetPlanInput): Promise<void> {
  await ensureBillingSchema();
  await db.execute({
    sql: `INSERT INTO workspace_plan (workspace_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            plan = excluded.plan,
            status = excluded.status,
            stripe_customer_id = COALESCE(excluded.stripe_customer_id, workspace_plan.stripe_customer_id),
            stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, workspace_plan.stripe_subscription_id),
            current_period_end = excluded.current_period_end,
            updated_at = excluded.updated_at`,
    args: [
      input.workspaceId, input.plan, input.status ?? "active",
      input.stripeCustomerId ?? null, input.stripeSubscriptionId ?? null,
      input.currentPeriodEnd ?? null, input.now,
    ],
  });
}

/** Count of invoices entered in this workspace over the rolling period. */
export async function usageThisPeriod(workspaceId: string, now: number): Promise<number> {
  await ensureBillingSchema();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM ap_events WHERE workspace_id = ? AND event_type = 'invoice.submitted' AND created_at >= ?`,
    args: [workspaceId, now - PERIOD_MS],
  }).catch(() => ({ rows: [{ c: 0 }] }));
  return Number((r.rows[0] as Record<string, unknown>).c);
}

export interface Entitlement {
  plan: Plan;
  used: number;
  limit: number | null; // null = unlimited
  canEnter: boolean;
  enforced: boolean;
}

/** What a workspace is allowed to do right now. Unenforced (unlimited) unless
 *  Stripe is configured and this is a real user's workspace. */
export async function entitlement(workspaceId: string, now: number): Promise<Entitlement> {
  // Stripe governs email workspaces only. Wallet workspaces (w_…) are governed by
  // $AEMU tier via viewerEntitlement; the shared default workspace is never billed.
  const enforced = billingConfigured() && workspaceId !== DEFAULT_WORKSPACE && !workspaceId.startsWith("w_");
  const wp = await getPlan(workspaceId);
  const isPro = wp.plan === "pro" && wp.status === "active";
  const used = await usageThisPeriod(workspaceId, now);
  if (!enforced || isPro) {
    return { plan: wp.plan, used, limit: isPro ? null : freeEntryLimit(), canEnter: true, enforced };
  }
  const limit = freeEntryLimit();
  return { plan: "free", used, limit, canEnter: used < limit, enforced };
}

/** Entitlement at the current time (impure boundary — reads the clock here). */
export async function liveEntitlement(workspaceId: string): Promise<Entitlement> {
  return entitlement(workspaceId, Date.now());
}
