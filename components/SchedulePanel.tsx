"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";
import type { Cadence, SkillInputField, SkillStep } from "@/lib/types";
import type { WatchOp } from "@/lib/watches";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Set a skill to run itself on a cadence - the autonomous, self-running half. */
import { OPS_NEEDING_VALUE, ruleIsUsable } from "@/lib/watches";

/** Ops that compare against something the user has to supply. */
const NEEDS_VALUE = OPS_NEEDING_VALUE;

export function SchedulePanel({
  skillId,
  fields,
  plan = [],
  otherSkills = [],
}: {
  skillId: string;
  fields: SkillInputField[];
  /** The plan, for its capture steps and the rule they were recorded with. */
  plan?: SkillStep[];
  /** Skills this owner can trigger when the rule fires. */
  otherSkills?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { ready, gate, label } = useUsageGate();
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.example])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What this skill captures, and what the recorder was told about it. A skill
  // with no captures cannot be watched — there is no named value to compare.
  const captures = plan.filter((s) => s.action === "extract" && s.outputKey);
  const recorded = captures.find((s) => s.watchOp);
  const [watching, setWatching] = useState(!!recorded);
  const [key, setKey] = useState(recorded?.outputKey ?? captures[0]?.outputKey ?? "");
  // Prefilled from the rule set while recording — the point of asking at the
  // moment the person was looking at the value is not asking again here.
  const [op, setOp] = useState<WatchOp>((recorded?.watchOp as WatchOp) ?? "changed");
  const [opValue, setOpValue] = useState(recorded?.watchValue ?? "");
  const [thenSkill, setThenSkill] = useState("");
  // "below" with no number is a dead rule: it can never be satisfied, so the
  // watch would sit there looking armed and burning the allowance.
  const ruleReady = !watching || ruleIsUsable({ op, value: opValue });

  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId,
          cadence,
          input: values,
          ...(watching && key
            ? {
                rule: {
                  key,
                  op,
                  ...(NEEDS_VALUE.includes(op) ? { value: opValue } : {}),
                },
                ...(thenSkill
                  ? { action: { kind: "run_skill", skillId: thenSkill } }
                  : {}),
              }
            : {}),
        }),
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
      {captures.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-base)] border border-border p-4">
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={watching}
              onChange={(e) => setWatching(e.target.checked)}
              aria-label="Tell me when a value changes"
            />
            <span>Tell me when a value changes</span>
            {/* Tied to the SELECTED capture, not to whether any capture has a
                rule: the badge used to claim a recorded rule while showing the
                default for a value that never had one. */}
            {captures.find((c) => c.outputKey === key)?.watchOp && (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                from your recording
              </span>
            )}
          </label>

          {watching && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Value</Label>
                  <select
                    className={input}
                    value={key}
                    aria-label="Value to watch"
                    onChange={(e) => {
                      // Re-derive the rule from the capture just chosen. The
                      // three were independent state, so picking a different
                      // value silently kept the previous one's condition —
                      // watching "holders" with the rule recorded for "pnl",
                      // with nothing on screen saying so.
                      const next = e.target.value;
                      setKey(next);
                      const cap = captures.find((c) => c.outputKey === next);
                      setOp((cap?.watchOp as WatchOp) ?? "changed");
                      setOpValue(cap?.watchValue ?? "");
                    }}
                  >
                    {captures.map((c) => (
                      <option key={c.outputKey} value={c.outputKey}>
                        {c.outputKey}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>When it</Label>
                  <select
                    className={input}
                    value={op}
                    aria-label="Condition"
                    onChange={(e) => setOp(e.target.value as WatchOp)}
                  >
                    <option value="changed">changes</option>
                    {/* A list capture stores a JSON array, and a numeric compare
                        would silently read the first number in it. */}
                    {!captures.find((c) => c.outputKey === key)?.loop && (
                      <>
                        <option value="below">goes below</option>
                        <option value="above">goes above</option>
                      </>
                    )}
                    <option value="equals">equals</option>
                    <option value="contains">contains</option>
                    <option value="not_contains">stops containing</option>
                    <option value="appears">starts showing a value</option>
                    <option value="disappears">stops showing a value</option>
                  </select>
                </div>
                {(op === "appears" || op === "disappears") && (
                  <p className="text-xs text-ink-3 sm:col-span-3">
                    This watches the value going empty or non-empty. An element
                    removed from the page entirely is reported as the watch
                    failing instead — a value missing because a login lapsed
                    must not read as the value disappearing.
                  </p>
                )}
                {NEEDS_VALUE.includes(op) && (
                  <div className="flex flex-col gap-1.5">
                    <Label>This</Label>
                    <input
                      className={input}
                      value={opValue}
                      aria-label="Condition value"
                      onChange={(e) => setOpValue(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {otherSkills.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label>Then</Label>
                  <select
                    className={input}
                    value={thenSkill}
                    aria-label="What happens when it fires"
                    onChange={(e) => setThenSkill(e.target.value)}
                  >
                    <option value="">just tell me</option>
                    {otherSkills.map((s) => (
                      <option key={s.id} value={s.id}>
                        run &ldquo;{s.name}&rdquo;
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-ink-3">
                    The triggered run gets the value that fired it, and you are still told.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        {!ready ? (
          <Button variant="primary" onClick={gate}>
            {label}
          </Button>
        ) : (
          <Button variant="primary" onClick={schedule} disabled={busy || !ruleReady}>
            {busy
              ? "Scheduling…"
              : watching && captures.length > 0
                ? "⏱ Watch and tell me"
                : "⏱ Automate on schedule"}
          </Button>
        )}
        {!ruleReady && (
          <span className="text-sm text-ink-2">
            Give it something to compare against.
          </span>
        )}
        {error && <span className="text-sm text-ink-2">{error}</span>}
      </div>
    </Card>
  );
}
