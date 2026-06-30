"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Label } from "./ui";

/**
 * Owner-only: generate a selective-disclosure proof for one field of a run. The
 * resulting bundle proves that field against the run's committed (anchored)
 * root, revealing nothing else. Share it; anyone verifies it at
 * /verify-disclosure.
 */
export function DisclosureGenerator({
  runId,
  fields,
}: {
  runId: string;
  fields: string[];
}) {
  const [field, setField] = useState(fields[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch(
        `/api/runs/${runId}/disclose?field=${encodeURIComponent(field)}`,
      );
      const d = await r.json();
      if (!r.ok || !d.disclosure) {
        setError(d.error || "Could not generate a proof for that field.");
        setBundle("");
      } else {
        setBundle(JSON.stringify(d.disclosure, null, 2));
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard?.writeText(bundle);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (fields.length === 0) return null;

  return (
    <Card className="p-5">
      <Label>Selective disclosure</Label>
      <p className="mt-1.5 text-sm text-ink-2">
        Prove one field of this run to anyone — an output or input — without
        revealing the rest. The proof checks against this run&apos;s anchored
        commitment root.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          aria-label="Field to disclose"
          className="mono w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none focus:border-ink-3 sm:w-auto sm:flex-1"
        >
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={generate} disabled={busy || !field}>
          {busy ? "Generating…" : "Generate proof"}
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-ink-2" role="alert">
          {error}
        </p>
      )}
      {bundle && (
        <div className="mt-3">
          <textarea
            readOnly
            value={bundle}
            aria-label="Disclosure bundle"
            rows={6}
            className="mono w-full rounded-[var(--radius-base)] border border-border bg-bg p-3 text-xs text-ink-2 outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <Button variant="default" onClick={copy}>
              {copied ? "Copied ✓" : "Copy bundle"}
            </Button>
            <Link
              href="/verify-disclosure"
              className="text-xs text-ink hover:underline"
              target="_blank"
            >
              Open the verifier →
            </Link>
            <span className="text-xs text-ink-3">
              shareable · verifiable by anyone
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
