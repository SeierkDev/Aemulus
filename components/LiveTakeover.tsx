"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "./ui";

const VIEW_W = 1280;
const VIEW_H = 800;

/** Live takeover for an interactive checkpoint: watch the run's browser, drive
 *  it (e.g. complete a 2FA prompt), then Continue. */
export function LiveTakeover({ runId }: { runId: string }) {
  const router = useRouter();
  const imgRef = useRef<HTMLImageElement>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/runs/${runId}/live`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (d.data) setFrame(d.data as string);
      } catch {
        /* transient */
      }
    };
    const iv = setInterval(() => {
      if (stop) clearInterval(iv);
      else void tick();
    }, 700);
    void tick();
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [runId]);

  async function send(input: unknown) {
    await fetch(`/api/runs/${runId}/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    }).catch(() => {});
  }

  function toView(e: React.MouseEvent) {
    const el = imgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * VIEW_W,
      y: ((e.clientY - r.top) / r.height) * VIEW_H,
    };
  }

  async function resume() {
    setBusy(true);
    try {
      await fetch(`/api/runs/${runId}/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: true }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Live takeover</Label>
          <p className="mt-1 text-sm text-ink-2">
            The run paused for you. Complete the step (e.g. a 2FA code) in the
            view, then Continue.
          </p>
        </div>
        <Button variant="primary" onClick={resume} disabled={busy}>
          {busy ? "Resuming…" : "Continue ▶"}
        </Button>
      </div>
      <div
        className="mt-3 aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-base)] border border-border bg-surface-2"
        role="application"
        aria-label="Live run view — click and type to control the page"
        tabIndex={0}
        onClick={(e) => {
          const { x, y } = toView(e);
          void send({ type: "click", x, y });
        }}
        onWheel={(e) => void send({ type: "scroll", dy: e.deltaY })}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key.length === 1) {
            e.preventDefault();
            void send({ type: "text", text: e.key });
          } else if (["Enter", "Tab", "Backspace", "Escape"].includes(e.key)) {
            e.preventDefault();
            void send({ type: "key", key: e.key });
          }
        }}
      >
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={imgRef} src={`data:image/jpeg;base64,${frame}`} alt="Live run view" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">
            Connecting to the live session…
          </div>
        )}
      </div>
    </Card>
  );
}
