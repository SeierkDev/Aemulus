import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  seedApDemo,
  DEMO_INVOICE_ID,
  DEMO_FIXTURE,
  OVERRIDE_REASONS,
} from "@/lib/ap-controls/demo";
import { projectInvoiceEntry } from "@/lib/ap-controls/projections";
import { loadConnection } from "@/lib/qbo/oauth";
import { getApSession } from "@/lib/ap-controls/ap-session";
import { ApReview } from "@/components/ap/ApReview";
import { GenericReview } from "@/components/ap/GenericReview";

export const dynamic = "force-dynamic";

function reasonLabel(code: string | null): string {
  if (code === "DUPLICATE") return "Possible duplicate";
  if (code === "NEW_VENDOR") return "Unknown vendor";
  if (code === "TOTALS_MISMATCH") return "Totals don’t match";
  if (code === "OVER_CEILING") return "Over auto-entry limit";
  return code ?? "Needs review";
}

export default async function ApInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getApSession();
  if (!session) redirect("/ap/login");
  const ws = session.workspaceId;
  const conn = await loadConnection(ws).catch(() => null);
  const connected = !!conn && conn.status === "connected" && !!conn.accessToken;

  // The demo invoice keeps its richer, story-driven walkthrough.
  if (id === DEMO_INVOICE_ID) {
    await seedApDemo(ws);
    const state = await projectInvoiceEntry(id, ws);
    return (
      <ApReview
        invoiceId={id}
        initialState={state}
        fixture={DEMO_FIXTURE}
        reasons={[...OVERRIDE_REASONS]}
        reviewer={session.name}
        connected={connected}
      />
    );
  }

  // Any other workspace invoice: generic review from its sealed stream.
  const state = await projectInvoiceEntry(id, ws);
  if (state.lastSeq < 0) notFound(); // no such invoice

  if (state.status === "needs_review") {
    return (
      <GenericReview
        invoiceId={id}
        vendor={state.vendor}
        amount={state.amount}
        currency={state.currency}
        reasonLabel={reasonLabel(state.topReasonCode)}
        connected={connected}
      />
    );
  }

  // Already decided — a small sealed summary rather than a dead end.
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-8">
      <Link href="/ap/queue" className="text-sm text-ink-3 hover:text-ink">← Review queue</Link>
      <div className="mt-4 rounded-lg border border-border p-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight">{state.vendor ?? "Invoice"}</h1>
          <span className="tabular-nums text-lg font-semibold text-ink">
            {state.amount == null ? "—" : `$${state.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
        {state.status === "submitted" ? (
          <p className="mt-2 text-sm text-ink-2">
            Entered <span className="mono text-ink">{state.billNumber}</span> in{" "}
            {state.enterTarget === "quickbooks" ? "QuickBooks" : "your ledger"} — sealed to the audit log.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-2">Rejected — sealed to the audit log.</p>
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}
