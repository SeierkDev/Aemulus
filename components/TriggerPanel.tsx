"use client";

import { useState } from "react";
import { Button, Card, Label } from "./ui";
import type { TriggerMeta } from "@/lib/triggers";

/** Create/copy/delete inbound trigger URLs that start a run when POSTed to. */
export function TriggerPanel({
  skillId,
  initial,
}: {
  skillId: string;
  initial: TriggerMeta[];
}) {
  const [triggers, setTriggers] = useState<TriggerMeta[]>(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const urlFor = (token: string) =>
    typeof window !== "undefined"
      ? `${window.location.origin}/api/triggers/${token}`
      : `/api/triggers/${token}`;

  async function create() {
    setBusy(true);
    try {
      const r = await fetch(`/api/skills/${skillId}/triggers`, { method: "POST" });
      const d = await r.json();
      if (r.ok) setTriggers((t) => [d.trigger, ...t]);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const r = await fetch(`/api/triggers/manage/${id}`, { method: "DELETE" });
    if (r.ok) setTriggers((t) => t.filter((x) => x.id !== id));
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <Label>Trigger URLs</Label>
          <p className="mt-1 text-sm text-ink-2">
            POST to a trigger URL to start a run from your own system. JSON body
            keys matching this skill&apos;s inputs become the run input.
          </p>
        </div>
        <Button variant="primary" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "New trigger"}
        </Button>
      </div>

      {triggers.length === 0 ? (
        <p className="text-sm text-ink-3">No triggers yet.</p>
      ) : (
        <div className="grid gap-2">
          {triggers.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-[var(--radius-base)] border border-border bg-surface-2 p-2.5"
            >
              <code className="mono flex-1 truncate text-xs text-ink">
                {urlFor(t.token)}
              </code>
              <span className="shrink-0 text-xs text-ink-3">
                {t.fireCount} fired
              </span>
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(urlFor(t.token))
                    .then(() => setCopied(t.id))
                    .catch(() => {});
                }}
                className="shrink-0 text-xs text-ink-2 hover:text-ink"
              >
                {copied === t.id ? "Copied" : "Copy"}
              </button>
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 text-xs text-ink-3 hover:text-ink"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
