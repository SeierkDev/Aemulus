import Link from "next/link";
import { redirect } from "next/navigation";
import { ResetButton } from "@/components/ap/ResetButton";
import { IntakeUpload } from "@/components/ap/IntakeUpload";
import { seedApDemo } from "@/lib/ap-controls/demo";
import { liveInvoiceQueueAll } from "@/lib/ap-controls/projections";
import { getApSession } from "@/lib/ap-controls/ap-session";

export const dynamic = "force-dynamic";

function fmtAge(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function money(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function reasonLabel(code: string | null): string {
  if (code === "DUPLICATE") return "Possible duplicate";
  if (code === "NEW_VENDOR") return "Unknown vendor";
  if (code === "TOTALS_MISMATCH") return "Totals don’t match";
  if (code === "OVER_CEILING") return "Over auto-entry limit";
  return code ?? "Needs review";
}

export default async function ApQueuePage() {
  const session = await getApSession();
  if (!session) redirect("/ap/login");
  await seedApDemo(session.workspaceId);
  const queue = await liveInvoiceQueueAll(session.workspaceId);

  const atRisk = queue.reduce((s, q) => s + (q.amount ?? 0), 0);
  const oldest = queue.reduce((m, q) => Math.max(m, q.ageMs), 0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <header className="pt-8">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Needs your review</h1>
          <Link href="/ap/activity" className="mt-1 text-sm text-ink hover:underline">Activity →</Link>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          Invoices Aemulus wouldn’t enter without you. It never guesses on your money.
        </p>
        {queue.length > 0 && (
          <p className="mt-3 text-sm text-ink-2">
            <span className="font-semibold text-ink">{queue.length}</span> held ·{" "}
            <span className="font-semibold tabular-nums text-ink">{money(atRisk)}</span> at risk ·{" "}
            oldest <span className="text-ink">{fmtAge(oldest)}</span>
          </p>
        )}
      </header>

      <div className="mt-6">
        {queue.length === 0 ? (
          <div className="rounded-lg border border-border p-10 text-center">
            <p className="text-lg font-semibold tracking-tight">All clear</p>
            <p className="mt-1 text-sm text-ink-3">Every invoice has been entered and sealed.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            {/* header row */}
            <div className="grid grid-cols-[1.5fr_0.9fr_1.6fr_0.6fr_auto] items-center gap-4 border-b border-border bg-surface-2 px-4 py-2.5 text-xs text-ink-3">
              <span>Vendor</span>
              <span className="text-right">Amount</span>
              <span>Why held</span>
              <span>Age</span>
              <span className="w-16" />
            </div>
            {queue.map((q, i) => (
              <Link
                key={q.invoiceId}
                href={`/ap/invoice/${q.invoiceId}`}
                className={`grid grid-cols-[1.5fr_0.9fr_1.6fr_0.6fr_auto] items-center gap-4 px-4 py-3.5 text-sm transition hover:bg-surface-2 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span className="font-medium text-ink">{q.vendor}</span>
                <span className="text-right font-medium tabular-nums text-ink">{money(q.amount)}</span>
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span aria-hidden>⚑</span>
                  {reasonLabel(q.topReason)}
                </span>
                <span className="text-ink-3">{fmtAge(q.ageMs)}</span>
                <span className="w-16 text-right text-ink">Open →</span>
              </Link>
            ))}
          </div>
        )}

        {queue.length > 0 && (
          <p className="mt-4 text-xs text-ink-3">
            Every decision here is sealed to a tamper-evident audit log.
          </p>
        )}

        <IntakeUpload />
      </div>

      {/* Demo controls — deliberately quiet, out of the primary flow. */}
      <div className="mt-auto flex items-center gap-3 py-8 text-xs text-ink-3">
        <span>Demo controls</span>
        <span>·</span>
        <ResetButton label={queue.length === 0 ? "Replay the walkthrough" : "Reset"} />
      </div>
    </div>
  );
}
