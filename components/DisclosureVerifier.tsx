"use client";

import { useState } from "react";
import { Button, Card, Label } from "./ui";

interface Result {
  valid: boolean;
  bound?: boolean;
  runId?: string;
  field?: string;
  value?: string;
  root?: string;
}

/**
 * Public: paste a selective-disclosure bundle and verify it. Proves a single
 * field's value against a run's committed (on-chain anchored) root - without
 * exposing any other field. No sign-in, no private data.
 */
export function DisclosureVerifier({ initial = "" }: { initial?: string }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setResult(null);
    setError(null);
    let bundle: Record<string, unknown>;
    try {
      bundle = JSON.parse(text);
    } catch {
      setError("That isn't valid JSON. Paste the disclosure bundle exactly as generated.");
      setBusy(false);
      return;
    }
    try {
      const r = await fetch("/api/disclosures/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      const d = await r.json();
      setResult({
        valid: !!d.valid,
        bound: !!d.bound,
        runId: typeof d.runId === "string" ? d.runId : undefined,
        field: typeof bundle.field === "string" ? bundle.field : undefined,
        value: typeof bundle.value === "string" ? bundle.value : undefined,
        root: typeof bundle.root === "string" ? bundle.root : undefined,
      });
    } catch {
      setError("Could not reach the verifier. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <Label>Verify a disclosure</Label>
      <p className="mt-1.5 text-sm text-ink-2">
        Paste a disclosure bundle to check it against the run&apos;s committed
        root. It proves one field - nothing else is revealed.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{ "runId": "run_…", "field": "output.total", "value": "$42.00", "salt": "…", "proof": { "siblings": […] }, "root": "…" }'
        aria-label="Disclosure bundle"
        rows={6}
        className="mono mt-3 w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 p-3 text-xs outline-none placeholder:text-ink-3 focus:border-ink-3"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={verify} disabled={busy || !text.trim()}>
          {busy ? "Verifying…" : "Verify proof"}
        </Button>
        {error && (
          <span className="text-xs text-ink-2" role="alert">
            {error}
          </span>
        )}
      </div>

      {result && (
        <div className="mt-4 border-t border-border pt-4" role="status" aria-live="polite">
          {result.valid ? (
            <>
              <div className="text-sm font-semibold text-ink">✓ Proof verified</div>
              <p className="mt-1.5 text-sm text-ink-2">
                The field below is provably part of run{" "}
                <span className="mono text-ink">{result.runId}</span>&apos;s committed
                (on-chain anchored) root - and nothing else about the run is revealed.
              </p>
              <div className="mt-3 grid gap-1.5 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="mono w-14 shrink-0 text-ink-3">run</span>
                  <span className="mono text-ink">{result.runId}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="mono w-14 shrink-0 text-ink-3">field</span>
                  <span className="mono text-ink">{result.field}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="mono w-14 shrink-0 text-ink-3">value</span>
                  <span className="text-ink">{result.value}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="mono w-14 shrink-0 text-ink-3">root</span>
                  <span className="mono break-all text-ink-3">{result.root}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm font-semibold text-ink">
              ✗ This proof does not verify - its root doesn&apos;t match the run&apos;s
              committed root, or the field isn&apos;t part of it.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
