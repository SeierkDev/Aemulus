"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the bulk view while rows are still running. */
export function BulkLive({ bulkId, done, total }: { bulkId: string; done: number; total: number }) {
  const router = useRouter();
  useEffect(() => {
    if (done >= total) return;
    let stop = false;
    const iv = setInterval(async () => {
      if (stop) return clearInterval(iv);
      try {
        const r = await fetch(`/api/runs/bulk/${bulkId}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        router.refresh();
        if (d.done >= d.total) stop = true;
      } catch {
        /* transient */
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [bulkId, done, total, router]);
  return null;
}
