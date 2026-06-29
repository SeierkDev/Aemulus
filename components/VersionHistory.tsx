"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Label } from "./ui";
import { when } from "@/lib/format";
import type { SkillVersionMeta } from "@/lib/types";

/**
 * Version history for a skill: every save is snapshotted, and any prior version
 * can be restored (which itself becomes a new latest version). Lets creators
 * iterate on published skills without silently breaking them.
 */
export function VersionHistory({
  skillId,
  versions,
  current,
}: {
  skillId: string;
  versions: SkillVersionMeta[];
  current: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function restore(version: number) {
    setBusy(version);
    try {
      const r = await fetch(`/api/skills/${skillId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (r.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (versions.length <= 1) return null;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">Version history</h2>
      <p className="mt-1 text-sm text-ink-2">
        Every save is snapshotted. Restore any version to roll back.
      </p>
      <div className="mt-4 grid gap-2">
        {versions.map((v) => (
          <Card
            key={v.version}
            className="flex items-center justify-between p-3.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="mono">v{v.version}</span>
                {v.version === current && <Label>current</Label>}
                <span className="truncate text-ink-2">{v.name}</span>
              </div>
              <div
                className="mt-0.5 text-xs text-ink-3"
                suppressHydrationWarning
              >
                {when(v.createdAt)}
              </div>
            </div>
            {v.version !== current && (
              <button
                onClick={() => restore(v.version)}
                disabled={busy !== null}
                className="shrink-0 text-xs text-ink-2 hover:text-ink disabled:opacity-40"
              >
                {busy === v.version ? "Restoring…" : "Restore"}
              </button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
