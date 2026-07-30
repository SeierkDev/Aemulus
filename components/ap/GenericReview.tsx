"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const APPROVE_REASONS = [
  { code: "LEGITIMATE", label: "Legitimate charge" },
  { code: "REVIEWED_CORRECT", label: "Reviewed - correct" },
  { code: "APPROVED_FOR_PAYMENT", label: "Approved for payment" },
];
const REJECT_REASONS = [
  { code: "DUPLICATE", label: "Duplicate invoice" },
  { code: "WRONG_AMOUNT", label: "Amount is wrong" },
  { code: "NOT_OURS", label: "Not our invoice" },
  { code: "SUSPECTED_FRAUD", label: "Suspected fraud" },
];

const select = "rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink focus:border-border-strong focus:outline-none";

function money(n: number | null, c: string | null): string {
  if (n == null) return "-";
  return `${c && c !== "USD" ? c + " " : "$"}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Done =
  | { status: "submitted"; billNumber: string; target: string; verify: { valid: boolean; length: number } }
  | { status: "rejected" };

export function GenericReview({
  invoiceId, vendor, amount, currency, reasonLabel, connected,
}: {
  invoiceId: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  reasonLabel: string;
  connected: boolean;
}) {
  const router = useRouter();
  const [approveReason, setApproveReason] = useState(APPROVE_REASONS[0].code);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0].code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);

  async function decide(action: "approve" | "reject", reasonCode: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ap/${invoiceId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reasonCode }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === "limit_reached"
          ? "You’ve reached your monthly entry limit. Upgrade in Billing to continue."
          : data.error || "That couldn’t be recorded.");
        return;
      }
      setDone(data.status === "submitted"
        ? { status: "submitted", billNumber: data.billNumber, target: data.target, verify: data.verify }
        : { status: "rejected" });
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-8">
      <Link href="/ap/queue" className="text-sm text-ink-3 hover:text-ink">← Review queue</Link>

      <div className="mt-4 rounded-lg border border-border p-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight">{vendor ?? "Invoice"}</h1>
          <span className="tabular-nums text-lg font-semibold text-ink">{money(amount, currency)}</span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-2">
          <span aria-hidden>⚑</span> {reasonLabel}
        </p>
        <p className="mt-1 text-xs text-ink-3">Aemulus held this for you - it won’t enter it without your decision.</p>
      </div>

      {done ? (
        <div className="mt-6 rounded-lg border border-border p-5">
          {done.status === "submitted" ? (
            <p className="text-sm text-ink-2">
              Entered <span className="mono text-ink">{done.billNumber}</span> in{" "}
              {done.target === "quickbooks" ? "QuickBooks" : "your ledger"} -{" "}
              {done.verify.valid ? "sealed and verified ✓" : "seal check failed"}.
            </p>
          ) : (
            <p className="text-sm text-ink-2">Rejected - sealed to the audit log. It’s out of your queue.</p>
          )}
          <Link href="/ap/queue" className="mt-3 inline-block text-sm text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80">
            Back to the queue
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select className={select} value={approveReason} onChange={(e) => setApproveReason(e.target.value)}>
              {APPROVE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("approve", approveReason)}
              className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-30"
            >
              It’s legitimate - enter it →
            </button>
          </div>
          <p className="text-xs text-ink-3">
            {connected ? "Enters into QuickBooks and seals to the audit log." : "Enters into your ledger and seals to the audit log."}
          </p>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <select className={select} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
              {REJECT_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("reject", rejectReason)}
              className="text-sm text-ink-3 underline decoration-border-strong underline-offset-2 hover:text-ink disabled:opacity-30"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-ink">{error}</p>}
      <div className="py-10" />
    </div>
  );
}
