"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Card, Label, cx } from "@/components/ui";
import type { Skill, SkillInputField, SkillStep } from "@/lib/types";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

export function SkillEditor({ initial }: { initial: Skill }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [fields, setFields] = useState<SkillInputField[]>(
    initial.inputSchema.fields,
  );
  const [steps, setSteps] = useState<SkillStep[]>(initial.plan);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function patchField(i: number, p: Partial<SkillInputField>) {
    setFields((f) => f.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setSaved(false);
  }
  function removeField(i: number) {
    setFields((f) => f.filter((_, j) => j !== i));
    setSaved(false);
  }
  function addField() {
    setFields((f) => [...f, { key: "", label: "", example: "" }]);
    setSaved(false);
  }
  function patchStep(i: number, p: Partial<SkillStep>) {
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/skills/${initial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          plan: steps,
          inputSchema: { fields },
        }),
      });
      if (r.ok) setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/skills" className="mono text-sm font-semibold tracking-tight">
          ← skills
        </Link>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-ink-3">Saved</span>}
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>

      <div className="border-t border-border pt-8">
        {/* Identity */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label>Skill name</Label>
            <input
              className={input}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <input
              className={input}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="mono text-xs text-ink-3">{initial.id}</div>
        </Card>

        {/* Inputs */}
        <div className="mt-8 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Inputs</h2>
            <p className="mt-1 text-sm text-ink-2">
              The values that change each run.
            </p>
          </div>
          <Button variant="default" onClick={addField}>
            + Add input
          </Button>
        </div>
        <div className="mt-4 grid gap-3">
          {fields.length === 0 && (
            <Card className="p-5 text-sm text-ink-3">
              No variable inputs — this skill runs the same way every time.
            </Card>
          )}
          {fields.map((f, i) => (
            <Card key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 p-4">
              <Field label="Key">
                <input
                  className={input}
                  value={f.key}
                  onChange={(e) => patchField(i, { key: e.target.value })}
                />
              </Field>
              <Field label="Label">
                <input
                  className={input}
                  value={f.label}
                  onChange={(e) => patchField(i, { label: e.target.value })}
                />
              </Field>
              <Field label="Example">
                <input
                  className={input}
                  value={f.example}
                  onChange={(e) => patchField(i, { example: e.target.value })}
                />
              </Field>
              <button
                onClick={() => removeField(i)}
                className="self-end pb-2 text-xs text-ink-3 hover:text-ink"
              >
                Remove
              </button>
            </Card>
          ))}
        </div>

        {/* Steps */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Steps</h2>
          <p className="mt-1 text-sm text-ink-2">
            The generalized plan Mimic will execute.
          </p>
        </div>
        <div className="mt-4 grid gap-2">
          {steps.map((s, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-3">
                <span className="mono w-8 shrink-0 text-ink-3">
                  {String(i).padStart(2, "0")}
                </span>
                <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
                  {s.action}
                </span>
                <input
                  className={cx(input, "flex-1")}
                  value={s.intent}
                  onChange={(e) => patchStep(i, { intent: e.target.value })}
                />
              </div>
              <div className="mt-3 grid grid-cols-[160px_1fr] items-center gap-3 pl-11">
                <select
                  className={input}
                  value={s.valueSource}
                  onChange={(e) =>
                    patchStep(i, {
                      valueSource: e.target.value as SkillStep["valueSource"],
                    })
                  }
                >
                  <option value="none">no value</option>
                  <option value="input">from input</option>
                  <option value="constant">constant</option>
                </select>
                {s.valueSource === "input" ? (
                  <select
                    className={input}
                    value={s.inputKey}
                    onChange={(e) => patchStep(i, { inputKey: e.target.value })}
                  >
                    <option value="">— pick input —</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label || f.key}
                      </option>
                    ))}
                  </select>
                ) : s.valueSource === "constant" ? (
                  <input
                    className={input}
                    value={s.value}
                    placeholder="constant value"
                    onChange={(e) => patchStep(i, { value: e.target.value })}
                  />
                ) : (
                  <span className="truncate text-xs text-ink-3">
                    {s.target}
                    {s.selectors?.[0] ? `  ·  ${s.selectors[0]}` : ""}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="py-10" />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
