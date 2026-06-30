"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label, cx } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";

/** Let a signed-in wallet rate a published skill (one rating per wallet). */
export function RatingWidget({
  skillId,
  initialStars,
  initialComment,
}: {
  skillId: string;
  initialStars: number;
  initialComment: string;
}) {
  const router = useRouter();
  const { ready, gate, label } = useUsageGate();
  const [stars, setStars] = useState(initialStars || 0);
  const [comment, setComment] = useState(initialComment || "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (stars < 1) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/skills/${skillId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, comment }),
      });
      if (r.ok) {
        setDone(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <Label>{initialStars ? "Your rating" : "Rate this skill"}</Label>
      {!ready ? (
        <Button variant="default" onClick={gate}>
          {label} to rate
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-1 text-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setStars(n)}
                aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                aria-pressed={n <= stars}
                className={cx(
                  "transition-colors",
                  n <= stars ? "text-ink" : "text-ink-3 hover:text-ink-2",
                )}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional: how did it work for you?"
            aria-label="Review comment"
            rows={2}
            className="rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3"
          />
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={submit}
              disabled={busy || stars < 1}
            >
              {busy ? "Saving…" : initialStars ? "Update rating" : "Submit rating"}
            </Button>
            {done && <span className="text-xs text-ink-3">Saved</span>}
          </div>
        </>
      )}
    </Card>
  );
}
