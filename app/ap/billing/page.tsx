import Link from "next/link";
import { redirect } from "next/navigation";
import { getApViewer, liveViewerEntitlement } from "@/lib/ap-controls/ap-viewer";
import { billingConfigured } from "@/lib/ap-controls/billing";
import { BillingUpgrade } from "@/components/ap/BillingUpgrade";

export const dynamic = "force-dynamic";

export default async function ApBillingPage() {
  const viewer = await getApViewer();
  if (!viewer) redirect("/ap/login");

  const ent = await liveViewerEntitlement(viewer);
  const configured = billingConfigured();
  const buyUrl = process.env.AEMULUS_PUMP_URL || "https://pump.fun";
  const pct = ent.limit ? Math.min(100, Math.round((ent.used / ent.limit) * 100)) : 0;
  const planLabel = viewer.kind === "wallet" ? (viewer.tier ?? "—") : ent.plan === "pro" ? "Pro" : "Free";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-8">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <Link href="/ap/queue" className="mt-1 text-sm text-ink hover:underline">← Review queue</Link>
      </div>

      <div className="mt-6 rounded-lg border border-border p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-3">{viewer.kind === "wallet" ? "$AEMU tier" : "Current plan"}</span>
          <span className="text-lg font-semibold tracking-tight">{planLabel}</span>
        </div>
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ink-3">Invoices entered (30 days)</span>
            <span className="tabular-nums text-ink">{ent.used}{ent.limit != null ? ` / ${ent.limit}` : ""}</span>
          </div>
          {ent.limit != null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>

      {viewer.kind === "wallet" ? (
        ent.limit == null ? (
          <p className="mt-4 text-sm text-ink-2">Your $AEMU tier includes unlimited invoice entries.</p>
        ) : (
          <div className="mt-6">
            <p className="mb-3 text-sm text-ink-2">Hold more $AEMU to reach a higher tier and remove the monthly limit.</p>
            <a href={buyUrl} target="_blank" rel="noreferrer" className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90">
              Get $AEMU →
            </a>
          </div>
        )
      ) : ent.plan === "pro" ? (
        <p className="mt-4 text-sm text-ink-2">You’re on Pro — unlimited invoice entries.</p>
      ) : configured ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-ink-2">
            Pro removes the monthly limit on entered invoices. {ent.enforced && !ent.canEnter && "You’ve reached the free limit."}
          </p>
          <BillingUpgrade />
        </div>
      ) : (
        <p className="mt-6 text-sm text-ink-3">Billing isn’t set up for this workspace yet — the app is open with no limits.</p>
      )}
      <div className="py-10" />
    </div>
  );
}
