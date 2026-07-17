"use client";

import { useState } from "react";

export function BillingUpgrade() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upgrade() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ap/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Couldn’t start checkout.");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={upgrade}
        disabled={busy}
        className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-30"
      >
        {busy ? "…" : "Upgrade to Pro"}
      </button>
      {error && <p className="mt-2 text-sm text-ink">{error}</p>}
    </div>
  );
}
