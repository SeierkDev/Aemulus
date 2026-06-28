"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Pause/resume + delete controls for a schedule row. */
export function ScheduleControls({
  scheduleId,
  active,
}: {
  scheduleId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/schedules/${scheduleId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    }).catch(() => {});
    router.refresh();
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/schedules/${scheduleId}`, { method: "DELETE" }).catch(
      () => {},
    );
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="default" onClick={toggle} disabled={busy}>
        {active ? "Pause" : "Resume"}
      </Button>
      <Button variant="ghost" onClick={remove} disabled={busy}>
        Delete
      </Button>
    </div>
  );
}
