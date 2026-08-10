"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Take a copy of someone else's skill.
 *
 * Lands you in the editor on YOUR copy rather than showing a toast, because the
 * reason to fork is that something needs changing — a selector for your portal,
 * an input you fill differently — and the next thing you want is the place to
 * change it.
 */
export function ForkButton({ skillId, signedIn }: { skillId: string; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fork() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/skills/${skillId}/fork`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not fork this skill.");
      router.push(`/skills/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fork this skill.");
      setBusy(false);
    }
  }

  if (!signedIn) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={fork} disabled={busy}>
        {busy ? "Forking…" : "Fork"}
      </Button>
      {error && (
        <span className="text-xs text-ink" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
