"use client";

import { useState } from "react";
import { Button, Card, Label } from "./ui";
import { when } from "@/lib/format";
import type { WebhookMeta } from "@/lib/webhooks";

const inputCls =
  "flex-1 rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Register / delete webhooks; shows the signing secret once. */
export function WebhooksManager({ initial }: { initial: WebhookMeta[] }) {
  const [hooks, setHooks] = useState<WebhookMeta[]>(initial);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setSecret(d.secret);
      setHooks((h) => [
        { id: d.id, url, active: true, lastStatus: null, lastAt: null, createdAt: Date.now() },
        ...h,
      ]);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const r = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    if (r.ok) setHooks((h) => h.filter((x) => x.id !== id));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-app.com/aemulus-hook"
          aria-label="Webhook URL"
          className={inputCls}
        />
        <Button variant="primary" onClick={add} disabled={busy || !url.trim()}>
          {busy ? "Adding…" : "Add webhook"}
        </Button>
      </div>
      {error && <p className="text-sm text-ink-2">{error}</p>}

      {secret && (
        <Card className="border-border-strong p-4">
          <Label>Signing secret — copy it now, shown once</Label>
          <code className="mono mt-2 block truncate rounded bg-surface-2 px-3 py-2 text-xs text-ink">
            {secret}
          </code>
        </Card>
      )}

      {hooks.length > 0 && (
        <div className="grid gap-2">
          {hooks.map((h) => (
            <Card key={h.id} className="flex items-center justify-between p-3.5">
              <div className="min-w-0">
                <div className="mono truncate text-sm">{h.url}</div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {h.lastAt
                    ? `last delivery ${h.lastStatus ?? "—"} · ${when(h.lastAt)}`
                    : "no deliveries yet"}
                </div>
              </div>
              <button
                onClick={() => remove(h.id)}
                className="shrink-0 text-xs text-ink-3 hover:text-ink"
              >
                Delete
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
