"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Label, Badge } from "@/components/ui";
import type { InvoiceEntryState } from "@/lib/ap-controls/projections";

type Reason = { code: string; label: string };
type TraceItem = { call: string; result: string };

interface Fixture {
  vendor: string; invoiceNumber: string; invoiceDate: string; amount: number; currency: string;
  glAccount: string; terms: string; poNumber: string;
  lineItems: readonly { desc: string; qty: number; unit: number; total: number }[];
  subtotal: number; tax: number;
  fields: readonly { key: string; label: string; value: string; confidence: number }[];
  duplicateOf: { billNumber: string; vendor: string; invoiceNumber: string; amount: string; date: string; enteredAt: string };
  banner: string; replayFrames: readonly string[];
}

const REQUIRED = ["sourceInvoice", "duplicateComparison", "replay"] as const;
const EVIDENCE_LABELS: Record<string, string> = {
  sourceInvoice: "Source invoice",
  duplicateComparison: "Duplicate comparison",
  replay: "Agent replay",
};
const money = (n: number, ccy: string) =>
  `${ccy === "USD" ? "$" : ccy + " "}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Phase = "review" | "ready" | "done" | "skipped";

export function ApReview({
  invoiceId, initialState, fixture, reasons, reviewer,
}: {
  invoiceId: string;
  initialState: InvoiceEntryState;
  fixture: Fixture;
  reasons: Reason[];
  reviewer: string;
}) {
  const initPhase: Phase =
    initialState.status === "submitted" ? "done" : initialState.overrides.length > 0 ? "ready" : "review";

  const [phase, setPhase] = useState<Phase>(initPhase);
  // Seeing the invoice on screen counts as viewing the source.
  const [viewed, setViewed] = useState<Set<string>>(() => new Set(["sourceInvoice"]));
  const [dupOpen, setDupOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [billNumber, setBillNumber] = useState<string | null>(initialState.billNumber);
  const [verify, setVerify] = useState<{ valid: boolean; length: number } | null>(null);
  const [seal, setSeal] = useState<string | null>(initialState.latestSeal);

  const markViewed = (a: string) => setViewed((v) => new Set(v).add(a));
  const allEvidence = REQUIRED.every((a) => viewed.has(a));
  const canConfirm = reasonCode !== "" && allEvidence && !busy;

  async function confirmOverride() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ap/${invoiceId}/override`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasonCode, note, evidenceViewed: [...viewed] }),
      });
      const data = await res.json();
      if (Array.isArray(data.trace)) setTrace((t) => [...t, ...data.trace]);
      if (data.ok) {
        setModalOpen(false);
        setPhase("ready");
      } else {
        setError(data.banner || "The override was blocked.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/ap/${invoiceId}/submit`, { method: "POST" });
      const data = await res.json();
      if (Array.isArray(data.trace)) setTrace((t) => [...t, ...data.trace]);
      if (data.ok) {
        setBillNumber(data.billNumber);
        setVerify(data.verify);
        setSeal(data.seal);
        setPhase("done");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pb-16">
      <header className="flex items-center justify-between py-6">
        <Link href="/ap/queue" className="mono text-sm font-semibold tracking-tight">← queue</Link>
        <div className="text-right">
          <div className="font-semibold tracking-tight">{fixture.vendor} · {money(fixture.amount, fixture.currency)}</div>
          <div className="text-xs text-ink-3">{fixture.invoiceNumber} · reviewing as {reviewer}</div>
        </div>
      </header>

      {(phase === "review" || phase === "ready") && (
        <div className="rounded-lg border border-border-strong bg-surface-2 px-4 py-3 text-sm">
          {phase === "ready" ? (
            <span>✓ Duplicate flag cleared — ready to enter.</span>
          ) : (
            <span>⚑ {fixture.banner}</span>
          )}
        </div>
      )}

      {/* Side-by-side: source invoice ⟷ what Aemulus will enter */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <Label>Source invoice (mocked scan)</Label>
          <div className="mt-3 rounded-md border border-border bg-surface p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold">{fixture.vendor}</span>
              <span className="mono text-xs text-ink-3">{fixture.invoiceNumber}</span>
            </div>
            <div className="mt-1 text-xs text-ink-3">Date {fixture.invoiceDate} · {fixture.terms} · {fixture.poNumber}</div>
            <div className="mt-3 border-t border-border pt-3">
              {fixture.lineItems.map((li, i) => (
                <div key={i} className="flex justify-between py-0.5 text-xs">
                  <span className="text-ink-2">{li.qty}× {li.desc}</span>
                  <span className="mono">{money(li.total, fixture.currency)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-border pt-2 text-xs">
              <div className="flex justify-between text-ink-3"><span>Subtotal</span><span className="mono">{money(fixture.subtotal, fixture.currency)}</span></div>
              <div className="flex justify-between text-ink-3"><span>Tax</span><span className="mono">{money(fixture.tax, fixture.currency)}</span></div>
              <div className="mt-1 flex justify-between font-semibold"><span>Total</span><span className="mono">{money(fixture.amount, fixture.currency)}</span></div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <Label>What Aemulus will enter</Label>
          <div className="mt-3 grid gap-2">
            {fixture.fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <div className="text-xs text-ink-3">{f.label}</div>
                  <div className="text-ink">{f.value}</div>
                </div>
                <span className="mono text-xs text-ink-3">{Math.round(f.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Duplicate comparison */}
      <Card className="mt-4 p-5">
        <button type="button" onClick={() => { setDupOpen((o) => !o); markViewed("duplicateComparison"); }} className="flex w-full items-center justify-between text-left">
          <Label>Duplicate comparison {viewed.has("duplicateComparison") && <span className="ml-1 text-ink-3">viewed ✓</span>}</Label>
          <span className="mono text-xs text-ink-3">{dupOpen ? "hide" : "compare vs " + fixture.duplicateOf.billNumber}</span>
        </button>
        {dupOpen && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border-strong p-3 text-sm">
              <div className="text-xs text-ink-3">This invoice</div>
              <Row k="Invoice #" v={fixture.invoiceNumber} />
              <Row k="Amount" v={money(fixture.amount, fixture.currency)} />
              <Row k="Date" v={fixture.invoiceDate} />
            </div>
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="text-xs text-ink-3">Already entered — bill {fixture.duplicateOf.billNumber}</div>
              <Row k="Invoice #" v={fixture.duplicateOf.invoiceNumber} />
              <Row k="Amount" v={fixture.duplicateOf.amount} />
              <Row k="Date" v={fixture.duplicateOf.date} />
              <div className="mt-1 text-xs text-ink-3">{fixture.duplicateOf.enteredAt}</div>
            </div>
          </div>
        )}
      </Card>

      {/* Replay */}
      <Card className="mt-4 p-5">
        <button type="button" onClick={() => { setReplayOpen((o) => !o); markViewed("replay"); }} className="flex w-full items-center justify-between text-left">
          <Label>Agent replay {viewed.has("replay") && <span className="ml-1 text-ink-3">watched ✓</span>}</Label>
          <span className="mono text-xs text-ink-3">{replayOpen ? "hide" : "▶ play (mocked)"}</span>
        </button>
        {replayOpen && (
          <ol className="mt-3 grid gap-1.5">
            {fixture.replayFrames.map((fr, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-2">
                <span className="mono text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <span>{fr}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Actions / proof */}
      {phase === "review" && (
        <div className="mt-6 flex items-center gap-3">
          <button type="button" onClick={() => setPhase("skipped")} className="rounded-md border border-border px-4 py-2 text-sm text-ink-3 hover:border-border-strong">
            Skip — it is a duplicate
          </button>
          <button type="button" onClick={() => setModalOpen(true)} className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:border-ink-3">
            Not a duplicate — override →
          </button>
        </div>
      )}

      {phase === "ready" && (
        <div className="mt-6">
          <button type="button" disabled={busy} onClick={submit} className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:border-ink-3 disabled:opacity-50">
            {busy ? "Submitting…" : "Submit to QuickBooks"}
          </button>
        </div>
      )}

      {phase === "skipped" && (
        <Card className="mt-6 p-6">
          <p className="font-semibold tracking-tight">Skipped — nothing was entered.</p>
          <p className="mt-1 text-sm text-ink-3">This invoice was treated as a duplicate. <Link href="/ap/queue" className="text-ink hover:underline">Back to queue</Link>.</p>
        </Card>
      )}

      {phase === "done" && (
        <Card className="mt-6 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Entry recorded ✓</h2>
            <Badge className="text-ink">{verify ? (verify.valid ? "🔒 Sealed" : "✗ altered") : "🔒 Sealed"}</Badge>
          </div>
          <p className="mt-2 text-sm text-ink-2">
            Entered into QuickBooks as bill <span className="mono text-ink">{billNumber}</span> · {money(fixture.amount, fixture.currency)} · {fixture.vendor}.
          </p>
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-sm">
            <div className="text-xs text-ink-3">Override on this entry</div>
            <p className="mt-1">
              Duplicate flag cleared by <span className="font-semibold">{reviewer}</span> — reason{" "}
              <span className="text-ink">{reasons.find((r) => r.code === reasonCode)?.label ?? reasonCode}</span>.
            </p>
            <p className="mt-1 text-xs text-ink-3">Evidence viewed: source invoice, duplicate comparison, replay.</p>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs">
            <div className="text-ink-3">
              {verify ? `Verified: ${verify.length} sealed events replay intact.` : "Sealed & verifiable."}
              {seal && <> · code <span className="mono text-ink">aem_{seal.slice(0, 12)}</span></>}
            </div>
            <Link href="/ap/queue" className="text-ink hover:underline">Back to queue →</Link>
          </div>
        </Card>
      )}

      {/* Live control trace */}
      {trace.length > 0 && (
        <div className="mt-8">
          <Label>Control core (live)</Label>
          <div className="mono mt-2 grid gap-1 rounded-md border border-border bg-surface-2 p-3 text-xs">
            {trace.map((t, i) => (
              <div key={i} className="flex justify-between gap-4">
                <span className="text-ink-2">{t.call}</span>
                <span className="text-ink-3">→ {t.result}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Override modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => !busy && setModalOpen(false)}>
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold tracking-tight">Override the duplicate flag</h3>
            <p className="mt-1 text-sm text-ink-3">You’re confirming this is not a double payment. This is recorded, sealed, and needs a reason.</p>

            <div className="mt-4">
              <Label>Reason (required)</Label>
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink">
                <option value="">Select a reason…</option>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div className="mt-3">
              <Label>Note (optional)</Label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Acme reissued after a bounced payment" className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink" />
            </div>

            <div className="mt-4">
              <Label>Evidence required before override</Label>
              <div className="mt-2 grid gap-1">
                {REQUIRED.map((a) => (
                  <div key={a} className="flex items-center gap-2 text-sm">
                    <span className={viewed.has(a) ? "text-ink" : "text-ink-3"}>{viewed.has(a) ? "✓" : "○"}</span>
                    <span className={viewed.has(a) ? "text-ink-2" : "text-ink-3"}>{EVIDENCE_LABELS[a]}</span>
                  </div>
                ))}
              </div>
              {!allEvidence && <p className="mt-1 text-xs text-ink-3">Open the duplicate comparison and watch the replay first.</p>}
            </div>

            {error && <p className="mt-3 text-sm text-ink-2">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setModalOpen(false)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-3 hover:border-border-strong disabled:opacity-50">Cancel</button>
              <button type="button" onClick={confirmOverride} disabled={!canConfirm} className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink-3 disabled:opacity-40">
                {busy ? "Recording…" : "Confirm override"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="mt-1 flex justify-between">
      <span className="text-ink-3">{k}</span>
      <span className="mono text-ink">{v}</span>
    </div>
  );
}
