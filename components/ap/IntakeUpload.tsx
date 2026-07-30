"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Fields = { vendor: string; invoiceNumber: string; invoiceDate: string; amount: number; currency: string; confidence: number };
type Done = { billNumber: string; target: string; verify: { valid: boolean; length: number } };

const input = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink focus:border-border-strong focus:outline-none";

// Mirror the server's 12 MB cap client-side so a huge file is rejected instantly
// instead of being fully read + uploaded only to be 413'd.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export function IntakeUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "extracting" | "review" | "entering" | "done">("idle");
  const [fields, setFields] = useState<Fields | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      setError("Unsupported file type - upload a PDF, PNG, or JPEG.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is too large (max 12 MB).");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFileName(file.name);
    setError("");
    setDone(null);
    setPhase("extracting");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ap/intake", { method: "POST", body });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Couldn’t read the invoice.");
        setPhase("idle");
        return;
      }
      setFields(data.fields);
      setPhase("review");
    } catch {
      setError("Upload failed. Try again.");
      setPhase("idle");
    }
  }

  function set<K extends keyof Fields>(k: K, v: Fields[K]) {
    setFields((f) => (f ? { ...f, [k]: v } : f));
  }

  async function enter() {
    if (!fields) return;
    setError("");
    setPhase("entering");
    try {
      const res = await fetch("/api/ap/intake/enter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(
          data.error === "vendor_not_found"
            ? "That vendor isn’t in QuickBooks yet."
            : data.error === "limit_reached"
              ? "You’ve reached your monthly entry limit. Upgrade in Billing to continue."
              : "The invoice couldn’t be entered.",
        );
        setPhase("review");
        return;
      }
      setDone({ billNumber: data.billNumber, target: data.target, verify: data.verify });
      setPhase("done");
      router.refresh();
    } catch {
      setError("The invoice couldn’t be entered.");
      setPhase("review");
    }
  }

  function reset() {
    setPhase("idle");
    setFields(null);
    setDone(null);
    setError("");
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const lowConfidence = fields ? fields.confidence < 0.6 : false;

  return (
    <div className="mt-6 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Add an invoice</h2>
        <span className="text-xs text-ink-3">PDF, PNG, or JPEG</span>
      </div>

      {phase === "done" && done ? (
        <div className="mt-3">
          <p className="text-sm text-ink-2">
            Entered <span className="mono text-ink">{done.billNumber}</span> in{" "}
            {done.target === "quickbooks" ? "QuickBooks" : "your ledger"} - sealed{" "}
            {done.verify.valid ? "and verified ✓" : "(verify failed)"}.
          </p>
          <button type="button" onClick={reset} className="mt-3 text-sm text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80">
            Add another
          </button>
        </div>
      ) : phase === "review" && fields ? (
        <div className="mt-3">
          <p className="text-xs text-ink-3">
            Read from <span className="text-ink-2">{fileName}</span>. Check the details, then enter it.
            {lowConfidence && <span className="text-ink"> Low confidence - double-check the fields.</span>}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="col-span-2 text-xs text-ink-3">
              Vendor
              <input className={input} value={fields.vendor} onChange={(e) => set("vendor", e.target.value)} />
            </label>
            <label className="text-xs text-ink-3">
              Invoice #
              <input className={input} value={fields.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} />
            </label>
            <label className="text-xs text-ink-3">
              Date
              <input className={input} value={fields.invoiceDate} placeholder="YYYY-MM-DD" onChange={(e) => set("invoiceDate", e.target.value)} />
            </label>
            <label className="text-xs text-ink-3">
              Amount
              <input className={input} type="number" step="0.01" value={fields.amount} onChange={(e) => set("amount", Number(e.target.value))} />
            </label>
            <label className="text-xs text-ink-3">
              Currency
              <input className={input} value={fields.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={enter}
              disabled={phase !== "review"}
              className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-30"
            >
              Enter it →
            </button>
            <button type="button" onClick={reset} className="text-sm text-ink-3 underline decoration-border-strong underline-offset-2 hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={onFile}
            disabled={phase === "extracting"}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:opacity-90"
          />
          <p className="mt-2 text-xs text-ink-3">
            {phase === "extracting" ? "Reading the invoice…" : "Aemulus reads it, you confirm, and it’s entered and sealed."}
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ink">{error}</p>}
    </div>
  );
}
