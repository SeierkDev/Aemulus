import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Label } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { ResolveForm } from "@/components/ResolveForm";
import { RetryButton } from "@/components/RetryButton";
import { RunLive } from "@/components/RunLive";
import { getRun } from "@/lib/runs";
import { getSkill } from "@/lib/skills";
import { getSession } from "@/lib/auth";
import { explorerUrl } from "@/lib/receipt";
import { estimateRunCostUsd, formatUsd } from "@/lib/cost";
import { SOLANA } from "@/lib/solana";
import type { RunStepRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

function stepLabel(s: RunStepRecord): string {
  const v = s.value ? ` "${s.value}"` : "";
  return `${s.intent}${v}`;
}

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [run, session] = await Promise.all([getRun(id), getSession()]);
  if (!run || run.owner !== session?.pubkey) notFound();
  const skill = await getSkill(run.skillId);
  const inputs = Object.entries(run.input);
  const isTerminal = ["completed", "failed", "needs_review"].includes(run.status);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <RunLive runId={run.id} status={run.status} />
      <header className="flex items-center justify-between py-6">
        <Link href="/runs" className="mono text-sm font-semibold tracking-tight">
          ← runs
        </Link>
        <div className="flex items-center gap-3">
          {isTerminal && <RetryButton runId={run.id} />}
          <StatusBadge status={run.status} />
        </div>
      </header>

      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {skill?.name ?? "Run"}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span className="mono">{run.id}</span>
          {run.result && (
            <>
              <span>·</span>
              <span>{run.result}</span>
            </>
          )}
          {run.error && (
            <>
              <span>·</span>
              <span className="text-ink-2">{run.error}</span>
            </>
          )}
        </div>

        {/* Cost transparency */}
        <Card className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
          <div>
            <span className="text-ink-3">AI cost</span>{" "}
            {run.tokensIn + run.tokensOut > 0 ? (
              <span>
                {(run.tokensIn + run.tokensOut).toLocaleString()} operator tokens ·{" "}
                ~{formatUsd(estimateRunCostUsd(run.tokensIn, run.tokensOut))}
              </span>
            ) : (
              <span>no AI calls (deterministic)</span>
            )}
          </div>
          {skill && skill.owner !== run.owner && (
            <div>
              <span className="text-ink-3">Creator fee</span>{" "}
              <span>{SOLANA.runFee} $AEMU</span>
            </div>
          )}
        </Card>

        {inputs.length > 0 && (
          <Card className="mt-6 p-4">
            <Label>Inputs</Label>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {inputs.map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2 text-sm">
                  <span className="mono text-ink-3">{k}</span>
                  <span className="text-ink">{v}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Verifiable receipt */}
        {run.receiptHash && (
          <Card className="mt-6 p-4">
            <div className="flex items-center justify-between">
              <Label>Verifiable receipt</Label>
              <div className="flex items-center gap-3">
                {run.receiptSig && run.receiptCluster ? (
                  <a
                    href={explorerUrl(run.receiptSig, run.receiptCluster)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-ink hover:underline"
                  >
                    Anchored on Solana →
                  </a>
                ) : (
                  <span className="text-xs text-ink-3">
                    on-chain anchoring at launch
                  </span>
                )}
                <Link
                  href={`/verify/${run.id}`}
                  className="text-xs text-ink hover:underline"
                >
                  Verify →
                </Link>
              </div>
            </div>
            <div
              className="mono mt-2 truncate text-xs text-ink-2"
              title={run.receiptHash}
            >
              sha256:{run.receiptHash}
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              A tamper-evident hash of this run and every proof screenshot.
            </p>
          </Card>
        )}

        {/* Steps with proof */}
        <h2 className="mt-10 text-lg font-semibold tracking-tight">Steps</h2>
        <div className="mt-4 grid gap-3">
          {run.steps.length === 0 && (
            <Card className="p-6 text-sm text-ink-3">No steps recorded.</Card>
          )}
          {run.steps.map((s) => (
            <Card
              key={s.id}
              className={s.flagged ? "border-border-strong" : undefined}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="mono w-8 shrink-0 text-ink-3">
                  {String(s.idx).padStart(2, "0")}
                </span>
                <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
                  {s.action}
                </span>
                <span className="flex-1 truncate text-sm text-ink">
                  {stepLabel(s)}
                </span>
                <span className="mono text-xs text-ink-3">
                  {Math.round(s.confidence * 100)}%
                </span>
                {s.flagged && (
                  <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink">
                    Flagged
                  </span>
                )}
              </div>
              {s.note && (
                <div className="border-t border-border px-4 py-2 text-xs text-ink-3">
                  {s.note}
                </div>
              )}
              {s.flagged && run.status === "needs_review" && (
                <ResolveForm runId={run.id} stepIdx={s.idx} />
              )}
              {s.screenshot && (
                <div className="border-t border-border bg-bg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/${s.screenshot}`}
                    alt={`step ${s.idx} proof`}
                    className="max-h-[420px] w-full object-contain"
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
      <div className="py-10" />
    </div>
  );
}
