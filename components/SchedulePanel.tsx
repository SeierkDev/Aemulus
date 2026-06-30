"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";
import type { Cadence, SkillInputField } from "@/lib/types";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Set a skill to run itself on a cadence - the autonomous, self-running half. */
export function SchedulePanel({
  skillId,
  fields,
}: {
  skillId: string;
  fields: SkillInputField[];
}) {
  const router = useRouter();
  const { ready, gate, label } = useUsageGate();
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.example])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId, cadence, input: values }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      router.push("/schedules");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <Label>Run on a schedule</Label>
        <p className="mt-1 text-sm text-ink-2">
          Let this skill run itself, unattended, and report results in Runs.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Cadence</Label>
        <select
          className={input}
          value={cadence}
          aria-label="Cadence"
          onChange={(e) => setCadence(e.target.value as Cadence)}
        >
          <option value="hourly">Every hour</option>
          <option value="every6h">Every 6 hours</option>
          <option value="every12h">Every 12 hours</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays (Mon-Fri)</option>
          <option value="weekly">Every week</option>
        </select>
      </div>
      {fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label>{f.label || f.key}{f.secret ? " 🔒" : ""}</Label>
              <input
                className={input}
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                aria-label={f.label || f.key}
                placeholder={f.secret ? "stored encrypted" : f.example}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        {!ready ? (
          <Button variant="primary" onClick={gate}>
            {label}
          </Button>
        ) : (
          <Button variant="primary" onClick={schedule} disabled={busy}>
            {busy ? "Scheduling…" : "⏱ Automate on schedule"}
          </Button>
        )}
        {error && <span className="text-sm text-ink-2">{error}</span>}
      </div>
    </Card>
  );
}
