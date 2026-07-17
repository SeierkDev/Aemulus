import Link from "next/link";
import { redirect } from "next/navigation";
import { seedApDemo } from "@/lib/ap-controls/demo";
import { listLedgerBills, ledgerStats } from "@/lib/ap-controls/ledger";
import { liveInvoiceQueueAll } from "@/lib/ap-controls/projections";
import { verifyAggregate } from "@/lib/ap-controls/store";
import { getApSession } from "@/lib/ap-controls/ap-session";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function ApActivityPage() {
  if (!(await getApSession())) redirect("/ap/login");
  await seedApDemo();
  const [bills, stats, queue] = await Promise.all([
    listLedgerBills(20),
    ledgerStats(),
    liveInvoiceQueueAll(),
  ]);
  const verified = await Promise.all(bills.map((b) => verifyAggregate("invoice", b.invoiceId).then((v) => v.valid)));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <header className="pt-8">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <Link href="/ap/queue" className="mt-1 text-sm text-ink hover:underline">← Review queue</Link>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          Every invoice Aemulus has entered — each one sealed and independently verifiable.
        </p>
      </header>

      {/* Stat tiles */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Entered" value={String(stats.count)} />
        <Stat label="Total entered" value={money(stats.total)} />
        <Stat label="In review" value={String(queue.length)} />
      </div>

      {/* Entry feed */}
      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1.5fr_0.9fr_1fr_0.9fr_auto] items-center gap-4 border-b border-border bg-surface-2 px-4 py-2.5 text-xs text-ink-3">
          <span>Vendor</span>
          <span className="text-right">Amount</span>
          <span>Bill</span>
          <span>Entered</span>
          <span>Sealed</span>
        </div>
        {bills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-3">
            No entries yet. Enter an invoice from the review queue, or enable the activity feed.
          </div>
        ) : (
          bills.map((b, i) => (
            <div key={b.billNumber} className={`grid grid-cols-[1.5fr_0.9fr_1fr_0.9fr_auto] items-center gap-4 px-4 py-3 text-sm ${i > 0 ? "border-t border-border" : ""}`}>
              <span className="font-medium text-ink">{b.vendor}</span>
              <span className="text-right tabular-nums text-ink">{money(b.amount)}</span>
              <span className="mono text-xs text-ink-2">{b.billNumber}</span>
              <span className="text-ink-3">{fmtTime(b.enteredAt)}</span>
              <span className={verified[i] ? "text-ink-2" : "text-ink"}>{verified[i] ? "🔒 verified" : "✗ altered"}</span>
            </div>
          ))
        )}
      </div>

      <p className="mt-4 text-xs text-ink-3">
        Each row is a real, tamper-evident record — the seal is recomputed live and confirmed on load.
      </p>
      <div className="py-10" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}
