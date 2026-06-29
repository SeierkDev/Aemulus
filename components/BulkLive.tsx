"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the bulk view while rows are still running. */
export function BulkLive({ bulkId, done, total }: { bulkId: string; done: number; total: number }) {
  const router = useRouter();
  useEffect(() => {
    if (done >= total) return;
    let stop = false;
    let lastDone = done;
    const iv = setInterval(async () => {
      if (stop) return clearInterval(iv);
      try {
        const r = await fetch(`/api/runs/bulk/${bulkId}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        // Only re-render the server component when progress actually changed —
        // not every 2s regardless (avoids needless refetch/flicker).
        if (d.done !== lastDone) {
          lastDone = d.done;
          router.refresh();
        }
        if (d.done >= d.total) stop = true;
      } catch {
        /* transient */
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [bulkId, done, total, router]);
  return null;
}
