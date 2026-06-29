"use client";

import { useState } from "react";
import { Button, Card, Label } from "./ui";
import { when } from "@/lib/format";
import type { ApiKeyMeta } from "@/lib/api-keys";

/** Create / copy (once) / revoke API keys for the public /api/v1 surface. */
export function ApiKeysManager({ initial }: { initial: ApiKeyMeta[] }) {
  const [keys, setKeys] = useState<ApiKeyMeta[]>(initial);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "API key" }),
      });
      const d = await r.json();
      if (r.ok) {
        setFresh(d.key);
        setCopied(false);
        setKeys((k) => [d.meta, ...k]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const r = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (r.ok) setKeys((k) => k.filter((x) => x.id !== id));
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label>Your API keys</Label>
        <Button variant="primary" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create key"}
        </Button>
      </div>

      {fresh && (
        <Card className="border-border-strong p-4">
          <Label>New key — copy it now, it won&apos;t be shown again</Label>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono flex-1 truncate rounded bg-surface-2 px-3 py-2 text-xs text-ink">
              {fresh}
            </code>
            <Button
              variant="default"
              onClick={() => {
                // Only show "Copied" if the write actually succeeded — otherwise
                // the user thinks the one-time key is saved when it isn't.
                navigator.clipboard
                  ?.writeText(fresh)
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Card>
      )}

      {keys.length === 0 ? (
        <Card className="p-6 text-sm text-ink-3">
          No keys yet. Create one to call the API.
        </Card>
      ) : (
        <div className="grid gap-2">
          {keys.map((k) => (
            <Card key={k.id} className="flex items-center justify-between p-3.5">
              <div className="min-w-0">
                <div className="mono truncate text-sm">{k.prefix}</div>
                <div className="mt-0.5 text-xs text-ink-3" suppressHydrationWarning>
                  {k.name} · created {when(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${when(k.lastUsedAt)}` : " · never used"}
                </div>
              </div>
              <button
                onClick={() => revoke(k.id)}
                className="shrink-0 text-xs text-ink-3 hover:text-ink"
              >
                Revoke
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
