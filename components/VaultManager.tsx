"use client";

import { useState } from "react";
import { Button, Card, Label } from "./ui";
import { when } from "@/lib/format";
import type { VaultEntryMeta } from "@/lib/vault";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

/** Store per-host credentials (values are never shown back). */
export function VaultManager({ initial }: { initial: VaultEntryMeta[] }) {
  const [creds, setCreds] = useState<VaultEntryMeta[]>(initial);
  const [host, setHost] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!host.trim() || !key.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: host.trim(), key: key.trim(), value }),
      });
      if (r.ok) {
        // refresh list (metadata only)
        const list = await (await fetch("/api/vault")).json();
        setCreds(list.credentials ?? []);
        setHost("");
        setKey("");
        setValue("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const r = await fetch(`/api/vault/${id}`, { method: "DELETE" });
    if (r.ok) setCreds((c) => c.filter((x) => x.id !== id));
  }

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3 p-5">
        <Label>Add a credential</Label>
        <p className="text-sm text-ink-2">
          Stored encrypted and auto-filled into a run&apos;s matching input field
          for that host. Values are never shown again.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className={input}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="host, e.g. example.com"
            aria-label="Host"
          />
          <input
            className={input}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="field key, e.g. password"
            aria-label="Field key"
          />
          <input
            className={input}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value"
            aria-label="Value"
            autoComplete="off"
          />
        </div>
        <div>
          <Button variant="primary" onClick={save} disabled={busy || !host.trim() || !key.trim()}>
            {busy ? "Saving…" : "Save credential"}
          </Button>
        </div>
      </Card>

      {creds.length === 0 ? (
        <Card className="p-6 text-sm text-ink-3">No stored credentials.</Card>
      ) : (
        <div className="grid gap-2">
          {creds.map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-3.5">
              <div className="min-w-0">
                <div className="mono truncate text-sm">
                  {c.host} · {c.key}
                </div>
                <div className="mt-0.5 text-xs text-ink-3" suppressHydrationWarning>
                  added {when(c.createdAt)} · value hidden
                </div>
              </div>
              <button
                onClick={() => remove(c.id)}
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
