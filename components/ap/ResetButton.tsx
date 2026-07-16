"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResetButton({ label = "Reset demo" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/ap/reset", { method: "POST" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-sm text-ink hover:border-ink-3 disabled:opacity-50"
    >
      {busy ? "Resetting…" : label}
    </button>
  );
}
