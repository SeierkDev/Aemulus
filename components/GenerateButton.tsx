"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

/** Triggers generalization of a demonstration into a skill, then navigates. */
export function GenerateButton({ demonstrationId }: { demonstrationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/skills/generalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demonstrationId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      router.push(`/skills/${data.skill.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-ink-2">{error}</span>}
      <Button variant="primary" onClick={go} disabled={busy}>
        {busy ? "Generalizing…" : "Generalize →"}
      </Button>
    </div>
  );
}
