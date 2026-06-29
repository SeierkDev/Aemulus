"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

/** Claim accrued earnings; disabled until on-chain payouts are live. */
export function ClaimButton({
  claimable,
  enabled,
}: {
  claimable: number;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!enabled) {
    return (
      <div className="text-right">
        <Button variant="default" disabled>
          Claim (opens at launch)
        </Button>
        <p className="mt-2 text-xs text-ink-3">
          Settles on Solana once $AEMU is live.
        </p>
      </div>
    );
  }

  async function claim() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/earnings/claim", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Claim failed");
      setMsg(d.sig ? `Paid - ${String(d.sig).slice(0, 10)}…` : "Claimed");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button variant="primary" onClick={claim} disabled={busy || claimable <= 0}>
        {busy
          ? "Claiming…"
          : claimable > 0
            ? `Claim ${claimable.toLocaleString()} $AEMU`
            : "Nothing to claim"}
      </Button>
      {msg && <p className="mt-2 text-xs text-ink-3">{msg}</p>}
    </div>
  );
}
