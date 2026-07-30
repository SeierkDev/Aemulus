"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Label, cx } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";
import Image from "next/image";
import { Trace } from "@/components/record/Trace";
import { LiveView } from "@/components/record/LiveView";
import type { RecorderState } from "@/lib/types";

const VIEW_W = 1280;
const VIEW_H = 800;

const input =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

// Sites we've CONFIRMED aggressively block automation (captcha walls). We don't
// stop the user - just warn them so they don't waste a recording on a site that
// will loop a captcha no matter what. Only list sites we've actually verified;
// don't pre-judge untested ones (they may work fine).
const HARD_SITES: { re: RegExp; name: string }[] = [
  { re: /(^|\.)google\./, name: "Google" },
];
function hardSiteName(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  return HARD_SITES.find((s) => s.re.test(host))?.name ?? null;
}

const SPECIAL_KEYS = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export default function RecordPage() {
  const [title, setTitle] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [state, setState] = useState<RecorderState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { ready, gate, label } = useUsageGate();

  const recording = state?.status === "recording";
  const saved = state?.status === "saved" || state?.status === "stopped";

  const poll = useCallback(async () => {
    const r = await fetch("/api/record/status", { cache: "no-store" });
    if (r.ok) setState(await r.json());
  }, []);

  // Poll status (trace) while recording.
  useEffect(() => {
    if (!recording) return;
    pollRef.current = setInterval(poll, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [recording, poll]);

  // Stream screencast frames while recording.
  useEffect(() => {
    if (!recording) return;
    let ended = false;
    const es = new EventSource("/api/record/stream");
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.data) setFrame(d.data as string);
      } catch {
        /* ignore */
      }
    };
    // 'end' is the server intentionally finishing the stream → close for good.
    es.addEventListener("end", () => {
      ended = true;
      es.close();
    });
    // A transient drop (network blip, the 5-min serverless cap) should NOT kill
    // the live view permanently - let EventSource auto-reconnect. Only stop
    // reconnecting once the server has signalled a real end.
    es.onerror = () => {
      if (ended) es.close();
    };
    return () => {
      ended = true;
      es.close();
    };
  }, [recording]);

  async function sendInput(event: unknown) {
    await fetch("/api/record/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
    }).catch(() => {});
  }

  function toViewCoords(e: React.MouseEvent) {
    const el = imgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * VIEW_W,
      y: ((e.clientY - r.top) / r.height) * VIEW_H,
    };
  }

  function onViewClick(e: React.MouseEvent) {
    const { x, y } = toViewCoords(e);
    void sendInput({ type: "click", x, y });
  }
  function onViewWheel(e: React.WheelEvent) {
    void sendInput({ type: "scroll", dy: e.deltaY });
  }
  function onViewKey(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) {
      e.preventDefault();
      void sendInput({ type: "text", text: e.key });
    } else if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      void sendInput({ type: "key", key: e.key });
    }
  }

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
    setError(null);
    try {
      const r = await fetch("/api/record/stop", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to stop");
      setState(data.state);
      setFrame(null);
    } catch (e) {
      // Don't leave the UI stuck "Recording" with no signal if stop fails.
      setError(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setState(null);
    setTitle("");
    setStartUrl("");
    setError(null);
    setFrame(null);
  }

  const actions = state?.actions ?? [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" aria-label="Home" className="flex items-center gap-2 text-ink-3 transition-colors hover:text-ink">
          <span className="mono text-lg leading-none">←</span>
          <Image src="/aemulus-mark.png" alt="Aemulus" width={50} height={36} priority />
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

      <div className="grid flex-1 gap-6 border-t border-border pt-8 md:grid-cols-[340px_1fr]">
        {/* Left: controls + trace */}
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Record a task
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              A live browser opens here. Do a repetitive task once - click and
              type in the view - then stop, and we&apos;ll turn it into a skill
              that runs itself.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">
              This cloud recorder is best for{" "}
              <span className="text-ink-2">public sites and forms</span> that
              don&apos;t need a login. For{" "}
              <span className="text-ink-2">tools you sign into</span> (CRMs,
              invoicing, dashboards), record with the browser extension instead -
              it runs in your own already-signed-in browser, so there&apos;s no
              login to redo and no bot walls.
            </p>
          </div>

          <Link href="/#extension">
            <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-surface-2">
              <div>
                <p className="text-sm font-medium">
                  Recording a tool you log into?
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                  Use the browser extension - it records as you, already signed
                  in.
                </p>
              </div>
              <span className="mono shrink-0 text-sm text-ink-3">→</span>
            </Card>
          </Link>

          {!recording && !saved && (
            <Card className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <Label>Start URL</Label>
                <input
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  placeholder="e.g. a public site or form (no login needed)"
                  aria-label="Start URL"
                  className={input}
                />
                {hardSiteName(startUrl) && (
                  <div className="mt-1 rounded-[var(--radius-base)] border border-border-strong bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
                    <span className="text-ink">⚠ {hardSiteName(startUrl)} blocks
                    automated browsers.</span>{" "}
                    You&apos;ll likely hit a captcha that can&apos;t be passed -
                    even by hand. Try a different public site, or record with the
                    browser extension (it runs in your own browser). You can still
                    try here, but expect a block.
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Task name (optional)</Label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Enter invoice into CRM"
                  aria-label="Task name"
                  className={input}
                />
              </div>
              {!ready ? (
                <Button variant="primary" onClick={gate}>
                  {label}
                </Button>
              ) : (
                <Button variant="primary" onClick={start} disabled={busy}>
                  {busy ? "Starting…" : "Start recording"}
                </Button>
              )}
              {error && <p className="text-sm text-ink-2">{error}</p>}
            </Card>
          )}

          {recording && (
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <Label>Capturing</Label>
                <span className="mono text-2xl font-semibold">
                  {actions.length}
                </span>
              </div>
              <p className="text-sm text-ink-2">
                Steps recorded. Click and type directly in the live view, then
                stop when done.
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
                  <span className="text-ink">{actions.length} steps</span>.
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
            </Card>
          )}

          <Trace actions={actions} />
        </div>

        {/* Right: live interactive view */}
        <LiveView
          recording={recording}
          frame={frame}
          startUrl={state?.startUrl}
          imgRef={imgRef}
          onClick={onViewClick}
          onWheel={onViewWheel}
          onKey={onViewKey}
        />
      </div>

      <div className="py-6" />
    </div>
  );
}
