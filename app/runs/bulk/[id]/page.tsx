import Link from "next/link";
import { notFound } from "next/navigation";
import { Label } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { BulkLive } from "@/components/BulkLive";
import { ExportCsv } from "@/components/ExportCsv";
import { getBulkRun, listRunsByBulk } from "@/lib/runs";
import { getSkill } from "@/lib/skills";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["completed", "needs_review", "failed"]);

export default async function BulkRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bulk, session] = await Promise.all([getBulkRun(id), getSession()]);
  if (!bulk || bulk.owner !== session?.pubkey) notFound();

  const [skill, runs] = await Promise.all([
    getSkill(bulk.skillId),
    listRunsByBulk(id),
  ]);

  const inputKeys = skill?.inputSchema.fields.map((f) => f.key) ?? [];
  const outputKeys = Array.from(
    new Set(runs.flatMap((r) => Object.keys(r.output ?? {}))),
  );
  const done = runs.filter((r) => TERMINAL.has(r.status)).length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const pct = bulk.total > 0 ? Math.round((done / bulk.total) * 100) : 0;

  // Flat rows for CSV export.
  const exportHeaders = ["row", ...inputKeys, "status", ...outputKeys];
  const exportRows = runs.map((r) => {
    const rec: Record<string, string> = {
      row: String((r.rowIndex ?? 0) + 1),
      status: r.status,
    };
    for (const k of inputKeys) rec[k] = r.input[k] ?? "";
    for (const k of outputKeys) rec[k] = r.output?.[k] ?? "";
    return rec;
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <BulkLive bulkId={bulk.id} done={done} total={bulk.total} />
      <header className="flex items-center justify-between py-6">
        <Link href="/runs" className="mono text-sm font-semibold tracking-tight">
          ← runs
        </Link>
        <ExportCsv
          headers={exportHeaders}
          rows={exportRows}
          filename={`aemulus-bulk-${bulk.id}.csv`}
        />
      </header>

      <div className="border-t border-border pt-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {skill?.name ?? bulk.skillId}
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Bulk run · {completed}/{bulk.total} completed
          {done < bulk.total && " · running…"}
        </p>

        {/* Progress bar */}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
        </div>

        {/* Results table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3 font-medium text-ink-3">#</th>
                {inputKeys.map((k) => (
                  <th key={k} className="py-2 pr-3 font-medium text-ink-3">
                    {k}
                  </th>
                ))}
                <th className="py-2 pr-3 font-medium text-ink-3">status</th>
                {outputKeys.map((k) => (
                  <th key={k} className="py-2 pr-3 font-medium text-ink-3">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="py-2 pr-3 text-ink-3">
                    <Link href={`/runs/${r.id}`} className="hover:text-ink">
                      {(r.rowIndex ?? 0) + 1}
                    </Link>
                  </td>
                  {inputKeys.map((k) => (
                    <td key={k} className="py-2 pr-3 text-ink-2">
                      {r.input[k] ?? ""}
                    </td>
                  ))}
                  <td className="py-2 pr-3">
                    <StatusBadge status={r.status} />
                  </td>
                  {outputKeys.map((k) => (
                    <td key={k} className="py-2 pr-3 text-ink">
                      {r.output?.[k] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {outputKeys.length === 0 && (
          <div className="mt-4 text-xs text-ink-3">
            <Label>Tip</Label>
            <p className="mt-1">
              Add an <span className="mono">extract</span> step to a skill to
              capture values into these results.
            </p>
          </div>
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}
