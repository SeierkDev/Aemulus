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
      className="text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-ink disabled:opacity-50"
    >
      {busy ? "Resetting…" : label}
    </button>
  );
}
