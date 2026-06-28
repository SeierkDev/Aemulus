"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label } from "./ui";
import { useUsageGate } from "./use-usage-gate";
import { csvToRows } from "@/lib/csv";

const inputCls =
  "w-full rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-ink-3";

type Field = { key: string; label: string; example: string };

/** Paste/upload a CSV of inputs and run the skill across every row. */
export function BulkRunPanel({
  skillId,
  fields,
  requireTrust = false,
}: {
  skillId: string;
  fields: Field[];
  requireTrust?: boolean;
}) {
  const router = useRouter();
  const { ready, gate, label } = useUsageGate();
  const [csv, setCsv] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keys = fields.map((f) => f.key);
  const parsed = useMemo(
    () => (csv.trim() ? csvToRows(csv, keys) : { rows: [], missing: [] }),
    [csv, keys],
  );

  const template = useMemo(() => {
    const header = keys.join(",");
    const example = fields.map((f) => f.example || "").join(",");
    return `${header}\n${example}`;
  }, [fields, keys]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/skills/${skillId}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed.rows }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Bulk run failed");
      router.push(`/runs/bulk/${data.bulkId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk run failed");
      setBusy(false);
    }
  }

  const blocked = requireTrust && !trusted;
  const canRun =
    parsed.rows.length > 0 && parsed.missing.length === 0 && !blocked;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <Label>Bulk run</Label>
        <button
          type="button"
          onClick={() => setCsv(template)}
          className="text-xs text-ink-3 hover:text-ink"
        >
          Insert template
        </button>
      </div>
      <p className="text-sm text-ink-2">
        Paste or upload a CSV with columns:{" "}
        <span className="mono text-ink">{keys.join(", ")}</span>. Each row runs
        once.
      </p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={template}
        aria-label="CSV rows"
        rows={5}
        className={`${inputCls} font-mono`}
      />
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        aria-label="Upload CSV file"
        className="text-xs text-ink-3 file:mr-3 file:rounded file:border file:border-border-strong file:bg-surface-2 file:px-2 file:py-1 file:text-ink-2"
      />

      {csv.trim() && (
        <div className="text-xs text-ink-3">
          {parsed.missing.length > 0 ? (
            <span className="text-ink-2">
              Missing column{parsed.missing.length > 1 ? "s" : ""}:{" "}
              <span className="mono">{parsed.missing.join(", ")}</span>
            </span>
          ) : (
            <span>
              {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} ready
            </span>
          )}
        </div>
      )}

      {requireTrust && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={trusted}
            onChange={(e) => setTrusted(e.target.checked)}
            className="accent-white"
          />
          I trust this skill and want to run it on every row.
        </label>
      )}

      {error && <p className="text-sm text-ink-2">{error}</p>}

      {!ready ? (
        <Button variant="primary" onClick={gate}>
          {label}
        </Button>
      ) : (
        <Button variant="primary" onClick={run} disabled={busy || !canRun}>
          {busy
            ? "Starting…"
            : parsed.rows.length > 0
              ? `Run ${parsed.rows.length} rows →`
              : "Run all rows →"}
        </Button>
      )}
    </Card>
  );
}
