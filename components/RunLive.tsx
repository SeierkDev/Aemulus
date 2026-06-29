"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const TERMINAL = new Set(["completed", "needs_review", "failed"]);

/**
 * Drives live updates on the run detail page while a run executes in the
 * background: polls the status endpoint and refreshes the server component as
 * steps stream in, stopping once the run reaches a terminal state.
 */
export function RunLive({
  runId,
  status,
}: {
  runId: string;
  status: string;
}) {
  const router = useRouter();
  const lastSteps = useRef<number>(-1);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    lastSteps.current = -1; // reset if this instance is reused for a new run
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        // Refresh when a new step lands or the run finishes.
        if (d.steps !== lastSteps.current || TERMINAL.has(d.status)) {
          lastSteps.current = d.steps;
          router.refresh();
        }
        // Mark done so the next interval clears itself (no further fetches).
        if (TERMINAL.has(d.status)) stop = true;
      } catch {
        /* transient */
      }
    };
    const iv = setInterval(() => {
      if (stop) clearInterval(iv);
      else void tick();
    }, 1500);
    return () => clearInterval(iv);
  }, [runId, status, router]);

  return null;
}
