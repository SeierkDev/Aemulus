"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Pause/resume + delete controls for a schedule row. */
export function ScheduleControls({
  scheduleId,
  active,
  acts = false,
}: {
  scheduleId: string;
  active: boolean;
  /** This watch runs a skill when it fires — offer a way to stop that. */
  acts?: boolean;
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

  async function disarm() {
    setBusy(true);
    // Clears the action only. Deleting the watch would take its baseline with
    // it, so the next check would have nothing to compare against and stay
    // quiet through the first real change.
    await fetch(`/api/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "alert" }),
    }).catch(() => {});
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      {acts && (
        <Button variant="ghost" onClick={disarm} disabled={busy}>
          Stop running it
        </Button>
      )}
      <Button variant="default" onClick={toggle} disabled={busy}>
        {active ? "Pause" : "Resume"}
      </Button>
      <Button variant="ghost" onClick={remove} disabled={busy}>
        Delete
      </Button>
    </div>
  );
}
