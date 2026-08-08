"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Label, cx } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";
import Image from "next/image";
import { Trace } from "@/components/record/Trace";
import { OPS_NEEDING_VALUE } from "@/lib/watches";
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
  const [capturing, setCapturing] = useState(false);
  const [captureKey, setCaptureKey] = useState("");
  const [captureOp, setCaptureOp] = useState("");
  const [captureOpValue, setCaptureOpValue] = useState("");
  /** True while a capture toggle is in flight, so the poll does not undo it. */
  const togglingRef = useRef(false);
  /**
   * Whether the extension is installed. null while unknown.
   *
   * The page told everyone to go and get it, installed or not — which reads as
   * the site not knowing anything about you. The extension marks the document
   * when its content script runs; absence is not proof it is missing (it only
   * injects on pages it has access to), so this only ever downgrades the nudge,
   * never blocks anything.
   */
  const [hasExt, setHasExt] = useState<boolean | null>(null);
  useEffect(() => {
    const seen = () =>
      document.documentElement.hasAttribute("data-aemulus-extension") ||
      !!(window as unknown as { __aemulusExtension?: unknown }).__aemulusExtension;
    // Always deferred, never set synchronously inside the effect: a setState in
    // the effect body triggers a cascading render, and the content script may
    // land after us anyway, so checking immediately would report "missing" for
    // an extension that is simply a beat behind.
    const t = setTimeout(() => setHasExt(seen()), seen() ? 0 : 1200);
    return () => clearTimeout(t);
  }, []);
  const [frame, setFrame] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { ready, gate, label } = useUsageGate();

  const recording = state?.status === "recording";
  const saved = state?.status === "saved" || state?.status === "stopped";

  const poll = useCallback(async () => {
    const r = await fetch("/api/record/status", { cache: "no-store" });
    if (!r.ok) return;
    const next = (await r.json()) as RecorderState;
    setState(next);
    /**
     * Follow the recorder, do not just remember what we asked for.
     *
     * The button was driven entirely by local state, so reloading the page
     * mid-recording showed "Capture a value" while the recorder was still
     * capturing — and that is the dangerous direction. You look at an off
     * button, click something in the live view expecting to press it, and it
     * gets read instead. The server is the truth here; this is the only place
     * that can tell.
     */
    // Not while a toggle is in flight. The poll runs every 1.2s and the server
    // does not know about the switch until its POST lands, so one arriving in
    // that window would report the OLD value and flip the button back under the
    // user's finger.
    if (
      !togglingRef.current &&
      next.status === "recording" &&
      typeof next.capturing === "boolean"
    ) {
      setCapturing(next.capturing);
    }
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
    // A fresh recorder starts with capture off. Without this the button still
    // reads "Capturing" from the previous session while the server is not, and
    // the first click presses the thing you were aiming at instead of reading
    // it — the one mistake that costs you the whole recording.
    setCapturing(false);
    setCaptureKey("");
    setCaptureOp("");
    setCaptureOpValue("");
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
      // detail carries WHY. Dropping it is what turned a specific server error
      // into "Couldn't start the recording." and left the cause to guesswork.
      if (!r.ok) {
        throw new Error(
          [data.error || "Failed to start", data.detail].filter(Boolean).join(" — "),
        );
      }
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Capture mode.
   *
   * Kept out of the live view's own click handling: while it is on, a click in
   * the streamed page is forwarded as usual, and the injected script swallows
   * it there and reports a capture instead. Doing it here would mean guessing
   * what the click landed on from a screenshot.
   */
  /**
   * Send the name as it is typed, not only when capture is switched on.
   *
   * The key was posted with the toggle and nowhere else, so turning capture on
   * and THEN typing a name left the server with the old one — and the capture
   * came back named after the element's label instead, which reads as the
   * naming field being ignored. The extension already pushes it live on every
   * keystroke; this is the web recorder catching up.
   *
   * Debounced, because the alternative is a request per character.
   */
  useEffect(() => {
    if (!capturing) return;
    const t = setTimeout(() => {
      void fetch("/api/record/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          on: true,
          key: captureKey.trim(),
          op: captureOp || undefined,
          opValue: captureOpValue.trim() || undefined,
        }),
      }).catch(() => {
        /* the name is a nicety; a failure here must not interrupt recording */
      });
    }, 350);
    return () => clearTimeout(t);
  }, [captureKey, captureOp, captureOpValue, capturing]);

  async function toggleCapture() {
    const next = !capturing;
    setCapturing(next); // optimistic: the streamed view should respond instantly
    togglingRef.current = true;
    try {
      const r = await fetch("/api/record/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          on: next,
          key: captureKey.trim(),
          op: captureOp || undefined,
          opValue: captureOpValue.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
    } catch (e) {
      setCapturing(!next); // put the button back where the recorder actually is
      setError(e instanceof Error ? e.message : "Could not switch capture mode.");
    } finally {
      togglingRef.current = false;
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

  // What has been marked so far, so you can see it read the right thing before
  // you stop — the commonest way to waste a recording is capturing the wrong
  // element and only finding out at the watch step.
  const captured = actions.filter((a) => a.type === "extract");

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

      {/* Mobile: the live recorder (and the browser extension) need a desktop. */}
      <div className="border-t border-border pt-8 md:hidden">
        <Card className="flex flex-col gap-4 p-6 text-center">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Record on your computer
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Recording a task needs a desktop browser, and for tools you log
              into it uses the Aemulus browser extension, which phones don&apos;t
              support. Open Aemulus on your computer to record a task.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">
              Everything else works here on mobile: browse the marketplace and run
              any skill on your own inputs.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href="/market">
              <Button variant="primary">Explore skills</Button>
            </Link>
            <Link href="/skills">
              <Button variant="default">Your skills</Button>
            </Link>
          </div>
        </Card>
      </div>

      <div className="hidden flex-1 gap-6 border-t border-border pt-8 md:grid md:grid-cols-[340px_1fr]">
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
                  {hasExt
                    ? "Extension installed"
                    : "Recording a tool you log into?"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                  {hasExt
                    ? "Record straight from the tab you're signed into - as you, on your own connection."
                    : "Use the browser extension - it records as you, already signed in."}
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
                <Label>Recorded</Label>
                <span className="mono text-2xl font-semibold">
                  {actions.length}
                </span>
              </div>
              <p className="text-sm text-ink-2">
                Steps recorded. Click and type directly in the live view, then
                stop when done.
              </p>

              {capturing && (
                <>
                  <input
                    value={captureKey}
                    onChange={(e) => setCaptureKey(e.target.value)}
                    maxLength={32}
                    placeholder="Name it (optional) - price, status, balance"
                    aria-label="Name for the captured value"
                    className={input}
                  />
                  {/* The same question the extension asks, at the same moment.
                      Without it, which recorder you happened to use decided
                      whether you could answer it at all. */}
                  <div className="flex gap-2">
                    <select
                      value={captureOp}
                      onChange={(e) => {
                        setCaptureOp(e.target.value);
                        if (!OPS_NEEDING_VALUE.includes(e.target.value as never)) {
                          setCaptureOpValue("");
                        }
                      }}
                      aria-label="Tell me when"
                      className={input}
                    >
                      <option value="">Tell me when it changes</option>
                      <option value="below">goes below</option>
                      <option value="above">goes above</option>
                      <option value="equals">equals</option>
                      <option value="contains">contains</option>
                      <option value="not_contains">stops containing</option>
                      <option value="appears">starts showing a value</option>
                      <option value="disappears">stops showing a value</option>
                    </select>
                    {OPS_NEEDING_VALUE.includes(captureOp as never) && (
                      <input
                        value={captureOpValue}
                        onChange={(e) => setCaptureOpValue(e.target.value)}
                        maxLength={120}
                        placeholder="value"
                        aria-label="Value to compare against"
                        className={input}
                      />
                    )}
                  </div>
                </>
              )}

              <button
                onClick={toggleCapture}
                aria-pressed={capturing}
                className={cx(
                  "rounded-[var(--radius-base)] border px-4 py-3 text-left text-sm transition-colors",
                  capturing
                    ? "border-ink bg-ink text-bg"
                    : "border-border-strong bg-surface-2 text-ink hover:border-ink-3",
                )}
              >
                <span className="font-semibold">
                  {capturing ? "Capturing a value — click it" : "Capture a value"}
                </span>
                <span
                  className={cx(
                    "mt-1 block text-xs",
                    capturing ? "text-bg/70" : "text-ink-3",
                  )}
                >
                  {capturing
                    ? "The next click reads that element instead of clicking it."
                    : "Turn this on, then click the number or status you want watched."}
                </span>
              </button>

              {captured.length > 0 && (
                <div className="rounded-[var(--radius-base)] border border-border bg-surface-2 p-3">
                  <Label>Captured</Label>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {captured.map((c, i) => (
                      <div key={i} className="flex items-baseline gap-3 text-xs">
                        <span className="mono shrink-0 text-ink-3">
                          {c.outputKey || c.name || "value"}
                        </span>
                        {/* A refused capture had its value blanked, so it
                            rendered here as a key with nothing beside it and
                            looked like it had worked. It never becomes a step,
                            and this panel sits next to the button — it has to
                            say so, not only the trace below. */}
                        {c.sensitive ? (
                          <span className="truncate text-ink-3">
                            refused - credential field, no step created
                          </span>
                        ) : (
                          <span className="truncate text-ink-2">{c.value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
