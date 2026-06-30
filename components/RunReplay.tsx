"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "./ui";

export interface ReplayStep {
  idx: number;
  action: string;
  intent: string;
  value: string;
  screenshot: string;
  flagged: boolean;
  note: string;
  confidence: number;
}

/**
 * Watch a run like a video: a single viewport over the per-step proof
 * screenshots with play / prev / next / scrub. Far easier to see "what the run
 * did" (and where it went wrong) than scrolling a stack of full-size images.
 */
export function RunReplay({ steps }: { steps: ReplayStep[] }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const n = steps.length;

  // Clamp if the step list shrinks (shouldn't, but safe).
  const cur = steps[Math.min(i, n - 1)];

  useEffect(() => {
    if (!playing || i >= n - 1) return; // not playing, or already at the end
    const t = setTimeout(() => {
      setI(i + 1);
      if (i + 1 >= n - 1) setPlaying(false); // stop once we land on the last step
    }, 1100);
    return () => clearTimeout(t);
  }, [playing, i, n]);

  if (n === 0) return null;

  const go = (next: number) => {
    setPlaying(false);
    setI(Math.max(0, Math.min(next, n - 1)));
  };

  return (
    <Card className="overflow-hidden">
      {/* viewport */}
      <div
        className="relative grid aspect-[16/10] place-items-center bg-bg outline-none"
        tabIndex={0}
        role="group"
        aria-label="Run replay"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
          else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
        }}
      >
        {cur.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/${cur.screenshot}`}
            alt={`Step ${cur.idx}: ${cur.intent}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-sm text-ink-3">No screenshot for this step.</span>
        )}
        {/* step caption overlay */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 py-2.5 text-xs">
          <span className="mono shrink-0 text-ink-2">
            {String(cur.idx).padStart(2, "0")}
          </span>
          <span className="rounded border border-border-strong bg-surface-2/80 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-2">
            {cur.action}
          </span>
          <span className="truncate text-ink">
            {cur.intent}
            {cur.value ? ` "${cur.value}"` : ""}
          </span>
          {cur.flagged && (
            <span className="ml-auto shrink-0 rounded-full border border-border-strong bg-surface-2/80 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink">
              Flagged
            </span>
          )}
        </div>
      </div>

      {/* controls (only when there's more than one step to move between) */}
      {n > 1 && (
      <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => (i >= n - 1 ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))}
          aria-label={playing ? "Pause replay" : "Play replay"}
          className="mono shrink-0 rounded border border-border-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-elevated"
        >
          {playing ? "❚❚ Pause" : i >= n - 1 ? "↻ Replay" : "▶ Play"}
        </button>
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          aria-label="Previous step"
          className="shrink-0 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-40"
        >
          ‹
        </button>
        <input
          type="range"
          min={0}
          max={n - 1}
          value={Math.min(i, n - 1)}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="Scrub steps"
          className="h-1 flex-1 accent-ink"
        />
        <button
          type="button"
          onClick={() => go(i + 1)}
          disabled={i >= n - 1}
          aria-label="Next step"
          className="shrink-0 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-40"
        >
          ›
        </button>
        <span className="mono shrink-0 text-xs text-ink-3">
          {Math.min(i + 1, n)} / {n}
        </span>
      </div>
      )}
    </Card>
  );
}
