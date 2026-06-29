"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card } from "./ui";
import { GenerateButton } from "./GenerateButton";
import { useUsageGate } from "./use-usage-gate";
import { when } from "@/lib/format";

type DemoLite = { id: string; title: string; steps: number; createdAt: number };

/**
 * Recordings list with multi-select. One demo → single-shot generalize. Two or
 * more of the SAME task → multi-demonstration synthesis, which learns what
 * varies (inputs) vs what's fixed (constants) and verifies against every demo.
 */
export function SynthesizePanel({ demos }: { demos: DemoLite[] }) {
  const router = useRouter();
  const { ready, gate, label } = useUsageGate();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function synthesize() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/skills/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demonstrationIds: [...sel] }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      router.push(`/skills/${data.skill.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  if (demos.length === 0) {
    return (
      <Card className="mt-6 p-8 text-center">
        <p className="text-sm text-ink-2">
          Nothing waiting.{" "}
          <Link href="/record" className="text-ink underline">
            Record a task
          </Link>
          .
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-6 grid gap-3">
      {demos.map((d) => (
        <Card key={d.id} className="flex items-center justify-between gap-3 p-4">
          <label className="flex min-w-0 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={sel.has(d.id)}
              onChange={() => toggle(d.id)}
              className="accent-white"
              aria-label={`Select ${d.title} for synthesis`}
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{d.title}</span>
              <span
                className="mt-1 block text-xs text-ink-3"
                suppressHydrationWarning
              >
                <span className="mono">{d.id}</span> · {d.steps} steps ·{" "}
                {when(d.createdAt)}
              </span>
            </span>
          </label>
          <GenerateButton demonstrationId={d.id} />
        </Card>
      ))}

      {sel.size >= 2 && (
        <Card className="sticky bottom-4 flex flex-col gap-3 border-border-strong p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-ink-2">
            <span className="text-ink">{sel.size} demonstrations</span> selected -
            synthesize one robust skill that learns what varies across them.
          </span>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-ink-2">{error}</span>}
            {!ready ? (
              <Button variant="primary" onClick={gate}>
                {label}
              </Button>
            ) : (
              <Button variant="primary" onClick={synthesize} disabled={busy}>
                {busy ? "Synthesizing…" : `Synthesize (${sel.size}) →`}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
