"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, Label, cx } from "@/components/ui";
import { RunPanel } from "@/components/RunPanel";
import { BulkRunPanel } from "@/components/BulkRunPanel";
import { SchedulePanel } from "@/components/SchedulePanel";
import { TriggerPanel } from "@/components/TriggerPanel";
import { PublishToggle } from "@/components/PublishToggle";
import { VersionHistory } from "@/components/VersionHistory";
import type { TriggerMeta } from "@/lib/triggers";
import type {
  ActionType,
  Skill,
  SkillInputField,
  SkillStep,
  SkillVersionMeta,
} from "@/lib/types";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

const STEP_ACTIONS: ActionType[] = [
  "navigate",
  "click",
  "input",
  "select",
  "key",
  "submit",
  "extract",
  "run_skill",
];

export function SkillEditor({
  initial,
  versions,
  triggers,
  otherSkills,
  myOrgs,
  isOwner,
}: {
  initial: Skill;
  versions: SkillVersionMeta[];
  triggers: TriggerMeta[];
  otherSkills: { id: string; name: string }[];
  myOrgs: { id: string; name: string }[];
  isOwner: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [fields, setFields] = useState<SkillInputField[]>(
    initial.inputSchema.fields,
  );
  const [steps, setSteps] = useState<SkillStep[]>(initial.plan);
  const [allowedHosts, setAllowedHosts] = useState(
    initial.allowedHosts.join(", "),
  );
  const [orgId, setOrgId] = useState(initial.orgId ?? "");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Stable client-side keys for the editable lists so React reconciles by
  // identity, not array index - otherwise removing/reordering a field or step
  // bleeds focus, cursor, and <select> state into the adjacent row.
  const seq = useRef(0); // only incremented in add handlers (never read in render)
  const [fieldKeys, setFieldKeys] = useState<string[]>(() =>
    fields.map((_, i) => `f${i}`),
  );
  const [stepKeys, setStepKeys] = useState<string[]>(() =>
    steps.map((_, i) => `s${i}`),
  );

  async function share(next: string) {
    const prev = orgId;
    setOrgId(next);
    try {
      const r = await fetch(`/api/skills/${initial.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: next || null }),
      });
      if (!r.ok) setOrgId(prev); // server rejected - don't lie about the state
    } catch {
      setOrgId(prev);
    }
  }
  const [busy, setBusy] = useState(false);

  function patchField(i: number, p: Partial<SkillInputField>) {
    setFields((f) => f.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setSaved(false);
  }
  function removeField(i: number) {
    setFields((f) => f.filter((_, j) => j !== i));
    setFieldKeys((k) => k.filter((_, j) => j !== i));
    setSaved(false);
  }
  function addField() {
    setFields((f) => [...f, { key: "", label: "", example: "" }]);
    setFieldKeys((k) => [...k, `a${seq.current++}`]);
    setSaved(false);
  }
  function patchStep(i: number, p: Partial<SkillStep>) {
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setSaved(false);
  }
  function addStep() {
    setSteps((s) => [
      ...s,
      {
        idx: s.length,
        intent: "Capture a value",
        action: "extract",
        selectors: [],
        target: "",
        valueSource: "none",
        value: "",
        inputKey: "",
        key: "",
        outputKey: "",
      },
    ]);
    setStepKeys((k) => [...k, `a${seq.current++}`]);
    setSaved(false);
  }
  function removeStep(i: number) {
    setSteps((s) =>
      s.filter((_, j) => j !== i).map((x, j) => ({ ...x, idx: j })),
    );
    setStepKeys((k) => k.filter((_, j) => j !== i));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setSaveError(false);
    try {
      const r = await fetch(`/api/skills/${initial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          plan: steps,
          inputSchema: { fields },
          allowedHosts: allowedHosts
            .split(/[,\s]+/)
            .map((h) => h.trim())
            .filter(Boolean),
        }),
      });
      if (r.ok) setSaved(true);
      else setSaveError(true); // surface failure instead of silently "saving"
    } catch {
      setSaveError(true);
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
          {/* The one place someone editing a skill can ask whether it is still
              working for the people running it. */}
          <Link
            href={`/skills/${initial.id}/analytics`}
            prefetch
            className="text-sm text-ink-3 underline underline-offset-4 hover:text-ink"
          >
            Analytics
          </Link>
          {saved && <span className="text-xs text-ink-3">Saved</span>}
          {saveError && (
            <span className="text-xs text-ink" role="alert">
              Save failed - try again
            </span>
          )}
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>

      <h1 className="sr-only">Edit skill: {name || initial.name}</h1>

      <div className="border-t border-border pt-8">
        {/* Identity */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label>Skill name</Label>
            <input
              className={input}
              value={name}
              aria-label="Skill name"
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
              aria-label="Skill description"
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Allowed domains</Label>
            <input
              className={input}
              value={allowedHosts}
              aria-label="Allowed domains"
              placeholder="e.g. example.com, app.example.com - empty = unrestricted"
              onChange={(e) => {
                setAllowedHosts(e.target.value);
                setSaved(false);
              }}
            />
            <p className="text-xs text-ink-3">
              The run may only navigate to these hosts (and subdomains). Empty
              allows any public host.
            </p>
          </div>
          {isOwner && myOrgs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Share with team</Label>
              <select
                className={input}
                value={orgId}
                aria-label="Share with team"
                onChange={(e) => share(e.target.value)}
              >
                <option value="">Personal (not shared)</option>
                {myOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-3">
                Team members can view and run it; admins can edit it.
              </p>
            </div>
          )}
          <div className="mono text-xs text-ink-3">{initial.id}</div>
        </Card>

        {/* Publish (owner only) */}
        {isOwner && (
          <div className="mt-6">
            <PublishToggle
              skillId={initial.id}
              initialPublished={initial.published}
              runCount={initial.runCount}
            />
          </div>
        )}

        {/* Run */}
        <div className="mt-6">
          {!initial.published && (
            <p className="mb-2 text-xs text-ink-3">
              Test run - private to you and earns nothing. Publish once it works.
            </p>
          )}
          <RunPanel
            skillId={initial.id}
            fields={initial.inputSchema.fields}
          />
        </div>

        {/* Bulk run */}
        {initial.inputSchema.fields.length > 0 && (
          <div className="mt-6">
            <BulkRunPanel
              skillId={initial.id}
              fields={initial.inputSchema.fields}
            />
          </div>
        )}

        {/* Schedule */}
        <div className="mt-6">
          <SchedulePanel
            skillId={initial.id}
            fields={initial.inputSchema.fields}
          />
        </div>

        {/* Trigger URLs (event-driven runs) - owner only */}
        {isOwner && (
          <div className="mt-6">
            <TriggerPanel skillId={initial.id} initial={triggers} />
          </div>
        )}

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
              No variable inputs - this skill runs the same way every time.
            </Card>
          )}
          {fields.map((f, i) => (
            <Card key={fieldKeys[i]} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
              <Field label="Key">
                <input
                  className={input}
                  value={f.key}
                  aria-label={`Input ${i + 1} key`}
                  onChange={(e) => patchField(i, { key: e.target.value })}
                />
              </Field>
              <Field label="Label">
                <input
                  className={input}
                  value={f.label}
                  aria-label={`Input ${i + 1} label`}
                  onChange={(e) => patchField(i, { label: e.target.value })}
                />
              </Field>
              <Field label="Example">
                <input
                  className={input}
                  value={f.secret ? "" : f.example}
                  disabled={f.secret}
                  placeholder={f.secret ? "(hidden)" : ""}
                  aria-label={`Input ${i + 1} example value`}
                  onChange={(e) => patchField(i, { example: e.target.value })}
                />
              </Field>
              <label className="flex flex-col items-center gap-1 self-end pb-2 text-xs text-ink-3">
                secret
                <input
                  type="checkbox"
                  checked={!!f.secret}
                  aria-label={`Field ${f.key || i + 1} is secret`}
                  onChange={(e) =>
                    patchField(i, {
                      secret: e.target.checked,
                      ...(e.target.checked ? { example: "" } : {}),
                    })
                  }
                />
              </label>
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
        <div className="mt-10 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Steps</h2>
            <p className="mt-1 text-sm text-ink-2">
              The generalized plan Aemulus will execute. Add an{" "}
              <span className="mono">extract</span> step to capture a value.
            </p>
          </div>
          <Button variant="default" onClick={addStep}>
            + Add step
          </Button>
        </div>
        <div className="mt-4 grid gap-2">
          {steps.map((s, i) => (
            <Card key={stepKeys[i]} className="p-4">
              <div className="flex items-center gap-3">
                <span className="mono w-8 shrink-0 text-ink-3">
                  {String(i).padStart(2, "0")}
                </span>
                <select
                  // Width BEFORE the shared input class, and the class stripped
                  // of its own w-full: the two collided, the select rendered
                  // full width, and it pushed Remove out past the card's edge
                  // where it could not be clicked.
                  className={cx(input.replace("w-full", ""), "w-28 shrink-0")}
                  value={s.action}
                  onChange={(e) =>
                    patchStep(i, { action: e.target.value as ActionType })
                  }
                  aria-label="Step action"
                >
                  {STEP_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <input
                  className={cx(input, "flex-1")}
                  value={s.intent}
                  aria-label={`Step ${i + 1} intent`}
                  onChange={(e) => patchStep(i, { intent: e.target.value })}
                />
                <button
                  onClick={() => removeStep(i)}
                  className="shrink-0 text-xs text-ink-3 hover:text-ink"
                >
                  Remove
                </button>
              </div>
              {s.action === "run_skill" ? (
                <div className="mt-3 grid grid-cols-[160px_1fr] items-center gap-3 pl-11">
                  <span className="text-xs text-ink-3">run skill</span>
                  <select
                    className={input}
                    value={s.subSkillId ?? ""}
                    aria-label={`Step ${i + 1} sub-skill`}
                    onChange={(e) => patchStep(i, { subSkillId: e.target.value })}
                  >
                    <option value="">- pick a skill -</option>
                    {otherSkills.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : s.action === "extract" ? (
                <div className="mt-3 grid gap-2 pl-11">
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <span className="text-xs text-ink-3">capture into key</span>
                    <input
                      className={input}
                      value={s.outputKey ?? ""}
                      // Bounded because the /watch wizard offers each capture as
                      // a Telegram button carrying the skill id and this key, and
                      // silently drops any button whose data runs over. A longer
                      // name still captures fine and simply never appears as
                      // something you can watch — which reads as the capture
                      // having failed. Editing here is the normal way to rename
                      // one, so capping the recorders alone left the front door
                      // open.
                      maxLength={32}
                      placeholder="e.g. price"
                      aria-label="Output key"
                      onChange={(e) =>
                        patchStep(i, { outputKey: e.target.value })
                      }
                    />
                  </div>
                  {(s.outputKey?.length ?? 0) > 32 && (
                    <div className="grid grid-cols-[160px_1fr] gap-3">
                      <span />
                      <p className="text-xs text-ink-3">
                        This name is too long to pick in a Telegram watch.
                        Shorten it to 32 characters or fewer.
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <span className="text-xs text-ink-3">selector</span>
                    <input
                      className={input}
                      value={s.selectors?.[0] ?? ""}
                      placeholder="CSS selector of the element to read"
                      aria-label="Selector"
                      onChange={(e) =>
                        patchStep(i, {
                          selectors: [e.target.value, ...(s.selectors?.slice(1) ?? [])],
                        })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-3">
                    <input
                      type="checkbox"
                      checked={!!s.loop}
                      aria-label={`Step ${i + 1} capture all matches`}
                      onChange={(e) => patchStep(i, { loop: e.target.checked })}
                    />
                    capture all matching elements (list)
                  </label>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-[160px_1fr] items-center gap-3 pl-11">
                  <select
                    className={input}
                    value={s.valueSource}
                    aria-label={`Step ${i + 1} value source`}
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
                      aria-label={`Step ${i + 1} input field`}
                      onChange={(e) =>
                        patchStep(i, { inputKey: e.target.value })
                      }
                    >
                      <option value="">- pick input -</option>
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
                      aria-label={`Step ${i + 1} constant value`}
                      onChange={(e) => patchStep(i, { value: e.target.value })}
                    />
                  ) : (
                    <span className="truncate text-xs text-ink-3">
                      {s.target}
                      {s.selectors?.[0] ? `  ·  ${s.selectors[0]}` : ""}
                    </span>
                  )}
                </div>
              )}

              {/* Branch condition (run only if…) */}
              <div className="mt-3 grid grid-cols-[160px_1fr] items-center gap-3 pl-11">
                <select
                  className={input}
                  value={s.condition?.kind ?? "none"}
                  aria-label={`Step ${i + 1} run condition`}
                  onChange={(e) =>
                    patchStep(i, {
                      condition:
                        e.target.value === "none"
                          ? undefined
                          : {
                              kind: e.target.value as "exists" | "absent",
                              selector: s.condition?.selector ?? "",
                            },
                    })
                  }
                >
                  <option value="none">always run</option>
                  <option value="exists">run if present</option>
                  <option value="absent">run if absent</option>
                </select>
                {s.condition && (
                  <input
                    className={input}
                    value={s.condition.selector}
                    placeholder="CSS selector to check"
                    aria-label={`Step ${i + 1} condition selector`}
                    onChange={(e) =>
                      patchStep(i, {
                        condition: { kind: s.condition!.kind, selector: e.target.value },
                      })
                    }
                  />
                )}
              </div>

              {/* Interactive checkpoint (live human takeover, e.g. 2FA) */}
              <label className="mt-2 flex items-center gap-2 pl-11 text-xs text-ink-3">
                <input
                  type="checkbox"
                  checked={!!s.interactive}
                  aria-label={`Step ${i + 1} interactive checkpoint`}
                  onChange={(e) => patchStep(i, { interactive: e.target.checked })}
                />
                pause here for a live human takeover (e.g. 2FA)
              </label>
            </Card>
          ))}
        </div>

        <VersionHistory
          skillId={initial.id}
          versions={versions}
          current={initial.version}
        />
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
