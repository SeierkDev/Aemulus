"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

/** Re-run a terminal run with the same input + any corrected selectors. */
export function RetryButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Retry failed");
      router.push(`/runs/${d.run.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Retry failed");
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button variant="default" onClick={retry} disabled={busy}>
        {busy ? "Retrying…" : "Retry"}
      </Button>
      {err && <p className="mt-1 text-xs text-ink-3">{err}</p>}
    </div>
  );
}
