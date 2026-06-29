"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Card, Label } from "@/components/ui";

/** Publish/unpublish a skill to the public marketplace, from its editor. */
export function PublishToggle({
  skillId,
  initialPublished,
  runCount,
}: {
  skillId: string;
  initialPublished: boolean;
  runCount: number;
}) {
  const [published, setPublished] = useState(initialPublished);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const r = await fetch(`/api/skills/${skillId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !published }),
      });
      if (r.ok) setPublished(!published);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex items-center justify-between p-5">
      <div>
        <Label>Marketplace</Label>
        <p className="mt-1 text-sm text-ink-2">
          {published ? (
            <>
              Public - anyone can run it.{" "}
              <Link href={`/market/${skillId}`} className="text-ink underline">
                View listing
              </Link>
              {runCount > 0 && (
                <span className="text-ink-3"> · {runCount} runs</span>
              )}
            </>
          ) : (
            "Private to your wallet. Publish to let anyone run it (and earn reputation)."
          )}
        </p>
      </div>
      <Button variant={published ? "default" : "primary"} onClick={toggle} disabled={busy}>
        {busy ? "…" : published ? "Unpublish" : "Publish"}
      </Button>
    </Card>
  );
}
