"use client";

import { useState } from "react";

/** Report a published skill (one per wallet). Subtle - it's a safety valve. */
export function ReportButton({ skillId }: { skillId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function report() {
    if (state === "busy" || state === "done") return;
    setState("busy");
    try {
      const r = await fetch(`/api/skills/${skillId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") return <span className="text-xs text-ink-3">Reported - thanks</span>;
  return (
    <button
      onClick={report}
      disabled={state === "busy"}
      className="text-xs text-ink-3 hover:text-ink disabled:opacity-50"
    >
      {state === "busy" ? "Reporting…" : state === "error" ? "Try again" : "Report"}
    </button>
  );
}
