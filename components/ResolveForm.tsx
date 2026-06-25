"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Label } from "@/components/ui";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/**
 * Shown on a flagged step of a paused run. The reviewer supplies a corrected
 * selector (or chooses to skip), then retries — the fix is merged into the
 * run's overrides and a fresh run executes.
 */
export function ResolveForm({
  runId,
  stepIdx,
}: {
  runId: string;
  stepIdx: number;
}) {
  const router = useRouter();
  const [selector, setSelector] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(payload: { selector?: string; skip?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/runs/${runId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIdx, ...payload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      router.push(`/runs/${data.run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border bg-surface-2 px-4 py-3">
      <Label>Resolve this step</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className={input}
          value={selector}
          placeholder='Corrected CSS selector, e.g. input[name="vendor"]'
          onChange={(e) => setSelector(e.target.value)}
        />
        <div className="flex shrink-0 gap-2">
          <Button
            variant="primary"
            disabled={busy || !selector.trim()}
            onClick={() => resolve({ selector: selector.trim() })}
          >
            {busy ? "Retrying…" : "Retry with fix"}
          </Button>
          <Button
            variant="default"
            disabled={busy}
            onClick={() => resolve({ skip: true })}
          >
            Skip & retry
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Retry re-runs the whole task with your fix applied. Earlier fixes are
        kept.
      </p>
      {error && <p className="mt-1 text-xs text-ink-2">{error}</p>}
    </div>
  );
}
