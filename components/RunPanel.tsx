"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "@/components/ui";
import type { SkillInputField } from "@/lib/types";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Enter input values and launch an autonomous run of this skill. */
export function RunPanel({
  skillId,
  fields,
}: {
  skillId: string;
  fields: SkillInputField[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.example])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId, input: values }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Run failed");
      router.push(`/runs/${data.run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <Label>Run this skill</Label>
          <p className="mt-1 text-sm text-ink-2">
            Mimic will execute the plan on its own and bring back proof.
          </p>
        </div>
      </div>
      {fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label>{f.label || f.key}</Label>
              <input
                className={input}
                value={values[f.key] ?? ""}
                placeholder={f.example}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={run} disabled={busy}>
          {busy ? "Running…" : "▶ Run now"}
        </Button>
        {error && <span className="text-sm text-ink-2">{error}</span>}
      </div>
    </Card>
  );
}
