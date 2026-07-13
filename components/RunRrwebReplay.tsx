"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "rrweb/dist/style.css";

type Replayer = {
  getMetaData: () => { totalTime: number };
  getCurrentTime: () => number;
  play: (t?: number) => void;
  pause: (t?: number) => void;
  on: (event: string, cb: () => void) => void;
  destroy?: () => void;
};

type ReplayerCtor = new (
  events: unknown[],
  opts: Record<string, unknown>,
) => Replayer;

// Load rrweb's prebuilt UMD bundle as a same-origin script (allowed by the CSP's
// script-src 'self'). We intentionally avoid importing rrweb's Replayer through
// webpack - Next's production minifier breaks its internal player state machine,
// so play() silently no-ops. The UMD build works untouched.
function loadRrweb(): Promise<{ Replayer: ReplayerCtor }> {
  const w = window as unknown as { rrweb?: { Replayer: ReplayerCtor } };
  if (w.rrweb?.Replayer) return Promise.resolve(w.rrweb);
  return new Promise((resolve, reject) => {
    const done = () =>
      w.rrweb?.Replayer
        ? resolve(w.rrweb)
        : reject(new Error("rrweb missing after load"));
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-rrweb]",
    );
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("rrweb load")));
      if (w.rrweb?.Replayer) done();
      return;
    }
    const s = document.createElement("script");
    s.src = "/vendor/rrweb.umd.min.js";
    s.async = true;
    s.dataset.rrweb = "1";
    s.onload = done;
    s.onerror = () => reject(new Error("rrweb load"));
    document.head.appendChild(s);
  });
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Pixel-perfect DOM replay of a run, reconstructed from rrweb events captured
 * while it executed - scrub, play, inspect the actual DOM as it changed. Uses
 * rrweb's native Replayer (guaranteed event-format match with our capture) under
 * a monochrome controller. Resources are inlined at capture time, so the replay
 * is self-contained and renders under the app's strict CSP.
 *
 * Fetches events from `src`; renders nothing if there are none (older runs,
 * capture disabled, or a capture that failed) so the caller falls back to the
 * screenshot replay.
 */
export function RunRrwebReplay({ src }: { src: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [playing, setPlaying] = useState(false);
  const [total, setTotal] = useState(0);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    let disposed = false;

    (async () => {
      let events: unknown[];
      try {
        const res = await fetch(src);
        if (!res.ok) return void (!disposed && setStatus("empty"));
        events = await res.json();
      } catch {
        return void (!disposed && setStatus("empty"));
      }
      if (!Array.isArray(events) || events.length < 2) {
        return void (!disposed && setStatus("empty"));
      }
      if (disposed || !stageRef.current) return;
      try {
        const { Replayer } = await loadRrweb();
        if (disposed || !stageRef.current) return;
        stageRef.current.innerHTML = "";
        const r = new Replayer(events, {
          root: stageRef.current,
          skipInactive: true,
          showWarning: false,
          mouseTail: false,
        });
        replayerRef.current = r;
        setTotal(r.getMetaData().totalTime);
        r.on("finish", () => {
          if (!disposed) setPlaying(false);
        });
        // Fit the recorded viewport to the container width.
        fitStage(stageRef.current);
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      try {
        replayerRef.current?.pause();
        replayerRef.current?.destroy?.();
      } catch {
        /* noop */
      }
      replayerRef.current = null;
    };
  }, [src]);

  // Advance the progress readout while playing.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const r = replayerRef.current;
      // getCurrentTime() can read negative before/at edges; clamp to [0, total].
      if (r) setCur(Math.max(0, Math.min(r.getCurrentTime(), total)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, total]);

  const toggle = useCallback(() => {
    const r = replayerRef.current;
    if (!r) return;
    if (playing) {
      r.pause();
      setPlaying(false);
    } else {
      // Before the first play, getCurrentTime() returns a large negative
      // baseline; clamp it, and restart from 0 once finished.
      const t = r.getCurrentTime();
      const at = t < 0 || t >= total ? 0 : t;
      r.play(at);
      setPlaying(true);
    }
  }, [playing, total]);

  const seek = useCallback(
    (ms: number) => {
      const r = replayerRef.current;
      if (!r) return;
      setCur(ms);
      if (playing) r.play(ms);
      else r.pause(ms);
    },
    [playing],
  );

  if (status === "empty") return null;

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
        <div ref={stageRef} className="rrweb-stage" />
      </div>
      {status === "loading" && (
        <p className="mt-2 text-sm text-ink-3">Loading replay…</p>
      )}
      {status === "error" && (
        <p className="mt-2 text-sm text-ink-3">
          Couldn&apos;t load the interactive replay.
        </p>
      )}
      {status === "ready" && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-sm text-ink hover:border-ink-3"
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <span className="mono text-xs text-ink-3">{fmt(cur)}</span>
          <input
            type="range"
            min={0}
            max={total || 1}
            value={Math.round(cur)}
            onChange={(e) => seek(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-ink"
            aria-label="Seek replay"
          />
          <span className="mono text-xs text-ink-3">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

// rrweb renders the iframe at the recorded viewport size; scale the wrapper to
// fit the container width so it doesn't overflow.
function fitStage(stage: HTMLElement) {
  const wrapper = stage.querySelector<HTMLElement>(".replayer-wrapper");
  const iframe = wrapper?.querySelector("iframe");
  if (!wrapper || !iframe) return;
  const w = iframe.offsetWidth || 1280;
  const h = iframe.offsetHeight || 800;
  const scale = Math.min(1, (stage.clientWidth || w) / w);
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.transformOrigin = "top left";
  stage.style.height = `${Math.round(h * scale)}px`;
}
