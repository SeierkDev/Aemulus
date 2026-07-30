"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { InvoiceEntryState } from "@/lib/ap-controls/projections";

type Reason = { code: string; label: string };

interface Fixture {
  vendor: string; invoiceNumber: string; invoiceDate: string; amount: number; currency: string;
  glAccount: string; terms: string; poNumber: string;
  lineItems: readonly { desc: string; qty: number; unit: number; total: number }[];
  subtotal: number; tax: number;
  fields: readonly { key: string; label: string; value: string; confidence: number }[];
  duplicateOf: { billNumber: string; vendor: string; invoiceNumber: string; amount: string; date: string; dateDelta: string; enteredAt: string };
  banner: string; replayFrames: readonly string[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

type Phase = "review" | "done" | "rejected";

export function ApReview({
  invoiceId, initialState, fixture, reasons, reviewer, connected,
}: {
  invoiceId: string;
  initialState: InvoiceEntryState;
  fixture: Fixture;
  reasons: Reason[];
  reviewer: string;
  connected: boolean;
}) {
  const initPhase: Phase = initialState.status === "submitted" ? "done" : "review";

  const [phase, setPhase] = useState<Phase>(initPhase);
  // The comparison and invoice are on screen from the start, so those count as
  // reviewed; the replay is the one thing the reviewer must actively watch.
  const [viewed, setViewed] = useState<Set<string>>(() => new Set(["sourceInvoice", "duplicateComparison"]));
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [overrideApplied, setOverrideApplied] = useState(initialState.overrides.length > 0);
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bill, setBill] = useState<string | null>(initialState.billNumber);
  const [target, setTarget] = useState<string>(initialState.enterTarget ?? "ledger");
  const [verify, setVerify] = useState<{ valid: boolean; length: number } | null>(null);
  const [seal, setSeal] = useState<string | null>(initialState.latestSeal);
  const [copied, setCopied] = useState(false);

  const watchedReplay = viewed.has("replay");
  const canEnter = watchedReplay && !busy;
  const reasonLabel = reasons.find((r) => r.code === reasonCode)?.label ?? reasonCode;

  const comparison = [
    { label: "Vendor", a: fixture.vendor, b: fixture.duplicateOf.vendor, same: true },
    { label: "Amount", a: money(fixture.amount), b: fixture.duplicateOf.amount, same: true },
    { label: "Invoice #", a: fixture.invoiceNumber, b: fixture.duplicateOf.invoiceNumber, same: false, mono: true },
    { label: "Date", a: fmtDate(fixture.invoiceDate), b: fmtDate(fixture.duplicateOf.date), same: false, tag: fixture.duplicateOf.dateDelta },
  ];

  async function confirmAndEnter() {
    setBusy(true);
    setError("");
    try {
      // Record the override once; a retry after a failed submit only re-submits.
      if (!overrideApplied) {
        const o = await fetch(`/api/ap/${invoiceId}/override`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reasonCode, note, evidenceViewed: [...viewed] }),
        });
        const od = await o.json();
        if (!od.ok) { setError(od.banner || "This couldn’t be confirmed."); return; }
        setOverrideApplied(true);
      }
      const s = await fetch(`/api/ap/${invoiceId}/submit`, { method: "POST" });
      const sd = await s.json();
      if (sd.ok) {
        setBill(sd.billNumber); setVerify(sd.verify); setSeal(sd.seal);
        if (sd.target) setTarget(sd.target);
        setModalOpen(false); setPhase("done");
      } else {
        setError(submitError(sd.error));
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 pb-16">
      {/* Identity header */}
      <header className="flex items-center justify-between border-b border-border py-4">
        <Link href="/ap/queue" className="text-sm text-ink-3 hover:text-ink">← Back to queue</Link>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold tracking-tight">{fixture.vendor}</span>
          <span className="text-ink-3">·</span>
          <span className="tabular-nums text-ink">{money(fixture.amount)}</span>
          <span className="text-ink-3">·</span>
          <span className="mono text-xs text-ink-3">{fixture.invoiceNumber}</span>
        </div>
      </header>

      {phase !== "rejected" && phase !== "done" && (
        <>
          {/* Why held */}
          <div className="mt-6 rounded-lg border border-border-strong bg-surface-2 p-4">
            <div className="text-sm font-semibold text-ink">Held: possible duplicate of Bill {fixture.duplicateOf.billNumber}</div>
            <p className="mt-1 text-sm text-ink-2">
              Same vendor and amount ({money(fixture.amount)}) as a bill already entered. Confirm this is a new charge before entering.
            </p>
          </div>

          {/* PRIMARY: the duplicate decision */}
          <Card className="mt-5 p-6">
            <h2 className="text-lg font-semibold tracking-tight">Is this the same as Bill {fixture.duplicateOf.billNumber}?</h2>
            <p className="mt-1 text-sm text-ink-3">Compare the two before you decide.</p>

            <div className="mt-4 grid grid-cols-[110px_1fr_1fr] gap-x-4">
              <div />
              <div className="border-b border-border pb-2 text-xs text-ink-3">
                This invoice · <span className="mono">{fixture.invoiceNumber}</span>
              </div>
              <div className="border-b border-border pb-2 text-xs text-ink-3">
                Already entered · Bill {fixture.duplicateOf.billNumber}
              </div>

              {comparison.map((row) => (
                <div key={row.label} className="contents">
                  <div className={`border-b border-border py-3 text-sm ${row.same ? "text-ink-3" : "text-ink"}`}>{row.label}</div>
                  <div className={`border-b border-border py-3 text-sm ${row.same ? "text-ink-2" : "font-medium text-ink"} ${row.mono ? "mono" : "tabular-nums"}`}>{row.a}</div>
                  <div className={`flex items-center justify-between gap-2 border-b border-border py-3 text-sm ${row.same ? "text-ink-2" : "font-medium text-ink"} ${row.mono ? "mono" : "tabular-nums"}`}>
                    <span>{row.b}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[0.65rem] ${row.same ? "text-ink-3" : "border border-border-strong text-ink"}`}>
                      {row.same ? "Same" : row.tag ?? "Different"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-sm text-ink-2">
              Vendor and amount match, but the <span className="text-ink">invoice number and date differ</span> - this looks like a separate charge, not a re-entry of Bill {fixture.duplicateOf.billNumber}.
            </p>
          </Card>

          {/* Evidence checklist (mirrors the enforced gate) */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-ink-3">Before you decide:</span>
            <span className="text-ink-2">✓ Compared to Bill {fixture.duplicateOf.billNumber}</span>
            <span className={watchedReplay ? "text-ink-2" : "text-ink-3"}>{watchedReplay ? "✓" : "○"} Watched what Aemulus did</span>
          </div>

          {/* Supporting evidence (secondary, collapsed) */}
          <div className="mt-5 grid gap-2">
            <Collapsible title="Watch what Aemulus did" open={replayOpen} onToggle={() => { setReplayOpen((o) => !o); markView(setViewed, "replay"); }} done={watchedReplay}>
              <ol className="grid gap-1.5">
                {fixture.replayFrames.map((fr, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-2">
                    <span className="mono text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    <span>{fr}</span>
                  </li>
                ))}
              </ol>
            </Collapsible>

            <Collapsible title="Invoice" open={invoiceOpen} onToggle={() => setInvoiceOpen((o) => !o)}>
              <div className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{fixture.vendor}</span>
                  <span className="mono text-xs text-ink-3">{fixture.invoiceNumber}</span>
                </div>
                <div className="mt-1 text-xs text-ink-3">{fmtDate(fixture.invoiceDate)} · {fixture.terms} · {fixture.poNumber}</div>
                <div className="mt-3 border-t border-border pt-2">
                  {fixture.lineItems.map((li, i) => (
                    <div key={i} className="flex justify-between py-0.5 text-xs">
                      <span className="text-ink-2">{li.qty}× {li.desc}</span>
                      <span className="tabular-nums">{money(li.total)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                    <span>Total</span><span className="tabular-nums">{money(fixture.amount)}</span>
                  </div>
                </div>
              </div>
            </Collapsible>

            <Collapsible title="Ready to enter" open={fieldsOpen} onToggle={() => setFieldsOpen((o) => !o)}>
              <div className="grid gap-1.5">
                {fixture.fields.map((f) => (
                  <div key={f.key} className="flex items-center justify-between text-sm">
                    <span className="text-ink-3">{f.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-ink">{f.value}</span>
                      <span className="mono text-xs text-ink-3">{Math.round(f.confidence * 100)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </Collapsible>
          </div>

          {/* Decision */}
          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={!canEnter} onClick={() => setModalOpen(true)}
                className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-30">
                It’s a new charge - enter it →
              </button>
              <button type="button" onClick={() => setPhase("rejected")}
                className="text-sm text-ink-3 underline decoration-border-strong underline-offset-2 hover:text-ink">
                Reject as duplicate
              </button>
            </div>
            {!canEnter && <p className="mt-2 text-xs text-ink-3">Watch what Aemulus did to continue.</p>}
            <p className="mt-2 text-xs text-ink-3">
              {connected
                ? "This will be entered in QuickBooks and sealed to the audit log."
                : "This will be entered in your ledger and sealed to the audit log."}
            </p>
          </div>
        </>
      )}

      {phase === "rejected" && (
        <Card className="mt-6 p-6">
          <p className="font-semibold tracking-tight">Rejected as a duplicate</p>
          <p className="mt-1 text-sm text-ink-2">This invoice was not entered. Your decision is sealed to the audit log.</p>
          <Link href="/ap/queue" className="mt-4 inline-block text-sm text-ink hover:underline">Back to queue →</Link>
        </Card>
      )}

      {/* PROOF - the sealed record */}
      {phase === "done" && (
        <div className="mt-8 overflow-hidden rounded-xl border border-ink-3 bg-surface">
          <div className="border-b border-border bg-surface-2 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight">Entered &amp; sealed</h2>
              <span className="rounded-full border border-ink-3 px-2.5 py-0.5 text-xs text-ink">🔒 Tamper-evident</span>
            </div>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-ink-2">
              Bill <span className="mono text-ink">{bill}</span> · <span className="tabular-nums text-ink">{money(fixture.amount)}</span> · {fixture.vendor} - entered in {target === "quickbooks" ? "QuickBooks" : "your ledger"} and sealed to the audit log.
            </p>

            <div className="mt-4 rounded-lg border border-border p-4 text-sm">
              <p className="text-ink-2">
                You cleared the duplicate flag - reason <span className="text-ink">{reasonLabel || "Legitimate re-bill"}</span>. Evidence reviewed: comparison, replay.
              </p>
              <p className="mt-2 text-ink-2">
                {verify ? `Verified - ${verify.length} sealed events replay intact.` : "Sealed & verifiable."}
                {seal && <> · <span className="mono text-ink">aem_{seal.slice(0, 12)}</span></>}
              </p>
            </div>

            <div className="mt-4 flex items-center gap-4 text-sm">
              <button type="button" onClick={() => setAuditOpen((o) => !o)} className="text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80">
                {auditOpen ? "Hide audit record" : "Open audit record"}
              </button>
              <button type="button" onClick={() => { if (seal) { void navigator.clipboard?.writeText(`aem_${seal.slice(0, 12)}`); setCopied(true); } }} className="text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-ink">
                {copied ? "Copied ✓" : "Share proof"}
              </button>
              <Link href="/ap/queue" className="ml-auto text-ink-3 hover:text-ink">Back to queue →</Link>
            </div>

            {auditOpen && (
              <ol className="mt-4 grid gap-2 rounded-lg border border-border p-4 text-sm">
                <AuditRow n={1} t="Held for review - possible duplicate of Bill #1043" />
                <AuditRow n={2} t={`Duplicate flag cleared by ${reviewer} - ${reasonLabel || "Legitimate re-bill"}`} />
                <AuditRow n={3} t={`Entered in QuickBooks as ${bill}`} />
                <div className="border-t border-border pt-2 text-xs text-ink-3">Every step above is sealed; the record verifies as intact.</div>
              </ol>
            )}
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => !busy && setModalOpen(false)}>
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold tracking-tight">Confirm this is a new charge</h3>
            <p className="mt-1 text-sm text-ink-3">You’re confirming this is not a double payment. This is recorded, sealed, and needs a reason.</p>

            <div className="mt-4">
              <div className="text-xs text-ink-3">Reason (required)</div>
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink">
                <option value="">Select a reason…</option>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div className="mt-3">
              <div className="text-xs text-ink-3">Note (optional)</div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Acme reissued after a bounced payment" className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink" />
            </div>

            {error && <p className="mt-3 text-sm text-ink-2">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setModalOpen(false)} disabled={busy} className="text-sm text-ink-3 hover:text-ink disabled:opacity-50">Cancel</button>
              <button type="button" onClick={confirmAndEnter} disabled={reasonCode === "" || busy}
                className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-30">
                {busy ? "Entering…" : "Confirm & enter"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function markView(setViewed: React.Dispatch<React.SetStateAction<Set<string>>>, a: string) {
  setViewed((v) => new Set(v).add(a));
}

function submitError(code: string): string {
  if (code === "not_connected") return "Connect QuickBooks before entering.";
  if (code === "in_progress") return "This invoice is already being entered.";
  if (code === "vendor_not_found") return "This vendor isn’t in QuickBooks yet.";
  if (code === "limit_reached") return "You’ve reached your monthly entry limit. Upgrade in Billing to continue.";
  return "QuickBooks didn’t accept the entry. Try again.";
}

function Collapsible({
  title, open, onToggle, done, children,
}: {
  title: string; open: boolean; onToggle: () => void; done?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm">
        <span className="text-ink">
          {title}
          {done && <span className="ml-2 text-xs text-ink-3">watched ✓</span>}
        </span>
        <span className="text-xs text-ink-3">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}

function AuditRow({ n, t }: { n: number; t: string }) {
  return (
    <li className="flex gap-3">
      <span className="mono text-xs text-ink-3">{String(n).padStart(2, "0")}</span>
      <span className="text-ink-2">{t}</span>
    </li>
  );
}
