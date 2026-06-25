"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Label, cx } from "@/components/ui";
import type { RecordedAction, RecorderState } from "@/lib/types";

function actionLabel(a: RecordedAction): string {
  switch (a.type) {
    case "navigate":
      return `Open ${a.value ?? ""}`;
    case "click":
      return `Click ${a.name || a.text || a.tag || "element"}`;
    case "input":
      return `Type "${a.value ?? ""}" into ${a.name || a.tag}`;
    case "select":
      return `Select "${a.value ?? ""}" in ${a.name || a.tag}`;
    case "key":
      return `Press ${a.key}`;
    case "submit":
      return `Submit ${a.name || "form"}`;
    default:
      return a.type;
  }
}

export default function RecordPage() {
  const [title, setTitle] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [state, setState] = useState<RecorderState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recording = state?.status === "recording";
  const saved = state?.status === "saved" || state?.status === "stopped";

  const poll = useCallback(async () => {
    const r = await fetch("/api/record/status", { cache: "no-store" });
    if (r.ok) setState(await r.json());
  }, []);

  useEffect(() => {
    if (recording) {
      pollRef.current = setInterval(poll, 1200);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [recording, poll]);

  async function start() {
    setError(null);
    if (!startUrl.trim()) {
      setError("Enter a URL to start from.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/record/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, startUrl }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to start");
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const r = await fetch("/api/record/stop", { method: "POST" });
      const data = await r.json();
      setState(data.state);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setState(null);
    setTitle("");
    setStartUrl("");
    setError(null);
  }

  const actions = state?.actions ?? [];
  const latest = actions[actions.length - 1];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          ← mimic
        </Link>
        <Badge>
          <span
            className={cx(
              "h-1.5 w-1.5 rounded-full",
              recording ? "animate-pulse bg-ink" : "bg-ink-3",
            )}
          />
          {recording ? "Recording" : saved ? "Saved" : "Ready"}
        </Badge>
      </header>

      <div className="grid flex-1 gap-6 border-t border-border pt-8 md:grid-cols-[360px_1fr]">
        {/* Left: controls */}
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Record a task
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              A Chromium window will open. Do the task once — Mimic captures
              every step with a screenshot. Then stop, and we&apos;ll turn it
              into a reusable skill.
            </p>
          </div>

          {!recording && !saved && (
            <Card className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <Label>Start URL</Label>
                <input
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  placeholder="example.com/form"
                  className="rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Task name (optional)</Label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Enter invoice into CRM"
                  className="rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3"
                />
              </div>
              <Button variant="primary" onClick={start} disabled={busy}>
                {busy ? "Opening browser…" : "Start recording"}
              </Button>
              {error && <p className="text-sm text-ink-2">{error}</p>}
            </Card>
          )}

          {recording && (
            <Card className="flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between">
                <Label>Capturing</Label>
                <span className="mono text-2xl font-semibold">
                  {actions.length}
                </span>
              </div>
              <p className="text-sm text-ink-2">
                Steps recorded so far. Keep going in the Chromium window, then
                stop when the task is done.
              </p>
              <Button variant="primary" onClick={stop} disabled={busy}>
                {busy ? "Saving…" : "Stop & save"}
              </Button>
            </Card>
          )}

          {saved && (
            <Card className="flex flex-col gap-4 p-5">
              <div>
                <Label>Demonstration saved</Label>
                <p className="mt-2 text-sm text-ink-2">
                  Captured{" "}
                  <span className="text-ink">{actions.length} steps</span>
                  {state?.demonstrationId && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="mono text-ink-3">
                        {state.demonstrationId}
                      </span>
                    </>
                  )}
                  .
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={reset}>
                  Record another
                </Button>
                <Link href="/skills">
                  <Button variant="default">Go to skills →</Button>
                </Link>
              </div>
              <p className="text-xs text-ink-3">
                Next phase turns this trace into a generalized skill.
              </p>
            </Card>
          )}
        </div>

        {/* Right: live trace + latest screenshot */}
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <Label>Live view</Label>
              {latest && (
                <span className="mono text-xs text-ink-3">
                  step {latest.idx}
                </span>
              )}
            </div>
            <div className="grid aspect-[16/10] place-items-center bg-bg">
              {latest?.screenshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/${latest.screenshot}`}
                  alt="latest captured step"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-sm text-ink-3">
                  {recording
                    ? "Waiting for the first action…"
                    : "No recording yet"}
                </span>
              )}
            </div>
          </Card>

          <Card className="flex min-h-[180px] flex-col">
            <div className="border-b border-border px-4 py-3">
              <Label>Trace</Label>
            </div>
            <ol className="flex-1 divide-y divide-border overflow-auto">
              {actions.length === 0 && (
                <li className="px-4 py-6 text-sm text-ink-3">
                  Steps will appear here as you interact with the page.
                </li>
              )}
              {[...actions].reverse().map((a) => (
                <li
                  key={a.idx}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="mono w-8 shrink-0 text-ink-3">
                    {String(a.idx).padStart(2, "0")}
                  </span>
                  <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
                    {a.type}
                  </span>
                  <span className="truncate text-ink-2">{actionLabel(a)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <div className="py-6" />
    </div>
  );
}
