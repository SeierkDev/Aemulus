"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "@/components/ui";
import type { QuotaStatus } from "@/lib/quota";
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
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  useEffect(() => {
    fetch("/api/quota")
      .then((r) => r.json())
      .then((d) => setQuota(d.quota ?? null))
      .catch(() => {});
  }, []);

  const out = quota ? !quota.unlimited && (quota.remaining ?? 0) <= 0 : false;

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
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={run} disabled={busy || out}>
          {busy ? "Running…" : out ? "Daily limit reached" : "▶ Run now"}
        </Button>
        {quota && (
          <span className="text-xs text-ink-3">
            {quota.unlimited
              ? `Unlimited runs · ${quota.tier}`
              : `${quota.remaining} of ${quota.limit} runs left today · ${quota.tier}`}
          </span>
        )}
        {error && <span className="text-sm text-ink-2">{error}</span>}
      </div>
      {out && (
        <p className="text-xs text-ink-3">
          You&apos;ve used your daily runs for the {quota?.tier} tier. Hold more
          $MIMIC to raise your limit, or come back in 24h.
        </p>
      )}
    </Card>
  );
}
