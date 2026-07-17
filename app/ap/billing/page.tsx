import Link from "next/link";
import { redirect } from "next/navigation";
import { getApSession } from "@/lib/ap-controls/ap-session";
import { liveEntitlement, billingConfigured } from "@/lib/ap-controls/billing";
import { BillingUpgrade } from "@/components/ap/BillingUpgrade";

export const dynamic = "force-dynamic";

export default async function ApBillingPage() {
  const session = await getApSession();
  if (!session) redirect("/ap/login");

  const ent = await liveEntitlement(session.workspaceId);
  const configured = billingConfigured();
  const pct = ent.limit ? Math.min(100, Math.round((ent.used / ent.limit) * 100)) : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-8">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <Link href="/ap/queue" className="mt-1 text-sm text-ink hover:underline">← Review queue</Link>
      </div>

      <div className="mt-6 rounded-lg border border-border p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-3">Current plan</span>
          <span className="text-lg font-semibold tracking-tight">{ent.plan === "pro" ? "Pro" : "Free"}</span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ink-3">Invoices entered (30 days)</span>
            <span className="tabular-nums text-ink">
              {ent.used}{ent.limit != null ? ` / ${ent.limit}` : ""}
            </span>
          </div>
          {ent.limit != null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>

      {ent.plan === "pro" ? (
        <p className="mt-4 text-sm text-ink-2">You’re on Pro — unlimited invoice entries.</p>
      ) : configured ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-ink-2">
            Pro removes the monthly limit on entered invoices. {ent.enforced && !ent.canEnter && "You’ve reached the free limit."}
          </p>
          <BillingUpgrade />
        </div>
      ) : (
        <p className="mt-6 text-sm text-ink-3">
          Billing isn’t set up for this workspace yet — the app is open with no limits.
        </p>
      )}
      <div className="py-10" />
    </div>
  );
}
