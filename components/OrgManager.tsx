"use client";

import { useRef, useState } from "react";
import { Button, Card, Label } from "./ui";
import { short } from "@/lib/format";

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

interface Member {
  wallet: string;
  role: "admin" | "member";
}
interface Org {
  id: string;
  name: string;
  role: "admin" | "member";
  members: Member[];
}

/** Create teams, add/remove members. Admins manage; members just appear. */
export function OrgManager({ initial, me }: { initial: Org[]; me: string }) {
  const [orgs, setOrgs] = useState<Org[]>(initial);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const d = await r.json();
      if (r.ok) {
        // The creator is added as an admin server-side (createOrg) - reflect it.
        setOrgs((o) => [
          { ...d.org, members: [{ wallet: me, role: "admin" }] },
          ...o,
        ]);
        setName("");
      }
    } finally {
      setBusy(false);
    }
  }

  // Re-entrancy guard: ignore a duplicate identical add/remove while one is in
  // flight (the buttons aren't disabled, so a double-click could double-submit).
  const inflight = useRef<Set<string>>(new Set());

  async function add(orgId: string) {
    const w = (wallet[orgId] ?? "").trim();
    if (!w) return;
    const k = `add:${orgId}:${w}`;
    if (inflight.current.has(k)) return;
    inflight.current.add(k);
    let r: Response;
    try {
      r = await fetch(`/api/orgs/${orgId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: w, role: "member" }),
      });
    } finally {
      inflight.current.delete(k);
    }
    if (r.ok) {
      setOrgs((os) =>
        os.map((o) =>
          o.id === orgId
            ? { ...o, members: [...o.members.filter((m) => m.wallet !== w), { wallet: w, role: "member" }] }
            : o,
        ),
      );
      setWallet((s) => ({ ...s, [orgId]: "" }));
    }
  }

  async function remove(orgId: string, w: string) {
    const k = `rm:${orgId}:${w}`;
    if (inflight.current.has(k)) return;
    inflight.current.add(k);
    let r: Response;
    try {
      r = await fetch(`/api/orgs/${orgId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: w }),
      });
    } finally {
      inflight.current.delete(k);
    }
    if (r.ok) {
      setOrgs((os) =>
        os.map((o) =>
          o.id === orgId ? { ...o, members: o.members.filter((m) => m.wallet !== w) } : o,
        ),
      );
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="flex flex-col gap-2 p-5 sm:flex-row">
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name"
          aria-label="Team name"
        />
        <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create team"}
        </Button>
      </Card>

      {orgs.length === 0 ? (
        <Card className="p-6 text-sm text-ink-3">
          No teams yet. Create one to share skills with other wallets.
        </Card>
      ) : (
        orgs.map((o) => (
          <Card key={o.id} className="grid gap-3 p-5">
            <div className="flex items-center justify-between">
              <Label>{o.name}</Label>
              <span className="text-xs text-ink-3">you are {o.role}</span>
            </div>
            <div className="grid gap-1.5">
              {o.members.map((m) => (
                <div key={m.wallet} className="flex items-center justify-between text-sm">
                  <span className="mono text-ink-2">
                    {short(m.wallet)} · {m.role}
                  </span>
                  {o.role === "admin" && (
                    <button
                      onClick={() => remove(o.id, m.wallet)}
                      className="text-xs text-ink-3 hover:text-ink"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {o.role === "admin" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className={input}
                  value={wallet[o.id] ?? ""}
                  onChange={(e) => setWallet((s) => ({ ...s, [o.id]: e.target.value }))}
                  placeholder="Member wallet address"
                  aria-label="Member wallet"
                />
                <Button variant="default" onClick={() => add(o.id)}>
                  Add member
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
