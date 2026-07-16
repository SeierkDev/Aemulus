import Link from "next/link";
import { Card, Label } from "@/components/ui";
import { ResetButton } from "@/components/ap/ResetButton";
import { seedApDemo, DEMO_INVOICE_ID } from "@/lib/ap-controls/demo";
import { liveInvoiceQueue } from "@/lib/ap-controls/projections";

export const dynamic = "force-dynamic";

function fmtAge(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function fmtMoney(n: number | null, ccy: string | null): string {
  if (n == null) return "—";
  return `${ccy === "USD" || !ccy ? "$" : ccy + " "}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const REASON_LABELS: Record<string, string> = {
  DUPLICATE: "Possible duplicate",
  NEW_VENDOR: "Unknown vendor",
  TOTALS_MISMATCH: "Totals don’t match",
  OVER_CEILING: "Over auto-entry limit",
};

export default async function ApQueuePage() {
  await seedApDemo();
  const queue = await liveInvoiceQueue([DEMO_INVOICE_ID]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="mt-1 text-sm text-ink-3">Invoices Aemulus held for a human — it won’t guess on your money.</p>
        </div>
        <ResetButton />
      </header>

      <div className="border-t border-border pt-6">
        {queue.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-lg font-semibold tracking-tight">Queue clear ✓</p>
            <p className="mt-1 text-sm text-ink-3">Every invoice has been entered. Reset the demo to run it again.</p>
            <div className="mt-4 flex justify-center">
              <ResetButton label="Replay the demo" />
            </div>
          </Card>
        ) : (
          <div className="grid gap-3">
            {queue.map((q) => (
              <Link key={q.invoiceId} href={`/ap/invoice/${q.invoiceId}`}>
                <Card className="flex items-center gap-4 p-4 transition hover:border-border-strong">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tracking-tight">{q.vendor}</span>
                      <span className="text-ink-3">·</span>
                      <span className="mono text-sm">{fmtMoney(q.amount, q.currency)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                      <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-ink">
                        ⚑ {REASON_LABELS[q.topReason ?? ""] ?? q.topReason ?? "Needs review"}
                      </span>
                      {q.pendingSecondApproval && (
                        <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5">
                          needs 2nd approval
                        </span>
                      )}
                      <span>· in queue {fmtAge(q.ageMs)}</span>
                    </div>
                  </div>
                  <span className="mono text-sm text-ink">Review →</span>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8">
          <Label>Control core</Label>
          <p className="mt-1 text-xs text-ink-3">
            This list is <span className="mono text-ink">projectInvoiceQueue()</span> folding the live{" "}
            <span className="mono text-ink">ap_events</span> stream — no mock. OCR, duplicate detection, the
            replay, auth, and QuickBooks keying are mocked; the decision + audit spine is real.
          </p>
        </div>
      </div>
    </div>
  );
}
