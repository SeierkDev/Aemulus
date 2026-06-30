"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";
import type { QuotaStatus } from "@/lib/quota";
import type { SkillInputField } from "@/lib/types";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Enter input values and launch an autonomous run of this skill. */
export function RunPanel({
  skillId,
  fields,
  domains = [],
  requireTrust = false,
}: {
  skillId: string;
  fields: SkillInputField[];
  /** Sites this skill will operate on (shown as a trust warning). */
  domains?: string[];
  /** When true (e.g. a marketplace skill you don't own), require a trust ack. */
  requireTrust?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    // Don't prefill secrets with the example - they're entered fresh each run.
    Object.fromEntries(fields.map((f) => [f.key, f.secret ? "" : f.example])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [trusted, setTrusted] = useState(!requireTrust);
  const { ready, gate, label } = useUsageGate();

  useEffect(() => {
    if (!ready) return;
    fetch("/api/quota")
      .then((r) => r.json())
      .then((d) => setQuota(d.quota ?? null))
      .catch(() => {});
  }, [ready]);

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
            Aemulus will execute the plan on its own and bring back proof.
          </p>
        </div>
      </div>
      {fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label>{f.label || f.key}{f.secret ? " 🔒" : ""}</Label>
              <input
                className={input}
                type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "off" : undefined}
                value={values[f.key] ?? ""}
                placeholder={f.secret ? "entered fresh each run" : f.example}
                aria-label={`${f.label || f.key}${f.secret ? " (secret)" : ""}`}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      )}
      {requireTrust && (
        <div className="rounded-[var(--radius-base)] border border-border-strong bg-surface-2 p-3.5">
          <Label>Before you run</Label>
          <p className="mt-1.5 text-sm text-ink-2">
            This skill operates on{" "}
            <span className="text-ink">
              {domains.length ? domains.join(", ") : "an inline page"}
            </span>{" "}
            and will enter your inputs there. Only run skills from sources you
            trust - your values are typed onto these sites.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={trusted}
              onChange={(e) => setTrusted(e.target.checked)}
              className="accent-white"
            />
            I understand and want to run this skill.
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!ready ? (
          <Button variant="primary" onClick={gate}>
            {label}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={run}
            disabled={busy || out || !trusted}
          >
            {busy ? "Running…" : out ? "Daily limit reached" : "▶ Run now"}
          </Button>
        )}
        {ready && quota && (
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
          $AEMU to raise your limit, or come back in 24h.
        </p>
      )}
    </Card>
  );
}
