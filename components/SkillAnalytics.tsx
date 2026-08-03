"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Label } from "@/components/ui";
import type { SkillAnalytics } from "@/lib/analytics";

/**
 * A published skill's own numbers.
 *
 * Built around the success rate rather than the run count. A total says the
 * skill was used; a rate says it worked, and a rate that is falling is the only
 * signal telling its author that a page changed underneath them.
 *
 * All three windows arrive with the page and switching between them is local
 * state. It used to be one link per window, which meant a full server round trip
 * and a re-query of the database to change numbers already on screen.
 */

const WINDOWS = [7, 30, 90] as const;

function pct(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(1)}%`;
}
const num = (n: number) => n.toLocaleString();

/** Direction against the previous window, worded so "no data" never reads as 0. */
function Delta({
  now,
  before,
  unit,
}: {
  now: number | null;
  before: number | null;
  unit: "runs" | "pt";
}) {
  if (now === null || before === null) {
    return <span className="text-ink-3">nothing earlier to compare</span>;
  }
  // Counts only. "Unchanged" describes a steady state somebody measured, and a
  // skill published an hour ago has not held steady at zero — it has not run.
  //
  // Deliberately NOT applied to the rate: a skill that ran ten times in each
  // period and failed every one has a rate of 0 in both, and calling that "no
  // runs yet" would hide a completely broken skill behind a message saying
  // nothing had happened. There, zero to zero really is unchanged.
  if (unit === "runs" && now === 0 && before === 0) {
    return <span className="text-ink-3">no runs yet</span>;
  }
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span className="text-ink-3">unchanged</span>;
  const up = d > 0;
  const shown =
    unit === "pt" ? `${Math.abs(d * 100).toFixed(1)}pt` : num(Math.round(Math.abs(d)));
  return (
    <span className={up ? "text-ok" : "text-warn"}>
      {up ? "+" : "−"}
      {shown} <span className="text-ink-3">vs previous period</span>
    </span>
  );
}

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-6 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="mono text-xs uppercase tracking-[0.13em] text-ink-3">{label}</div>
      <div className="mt-2.5 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

/**
 * The rate over time as its own shape. A rate sliding while volume climbs is
 * invisible in a stacked bar chart, and that is the case that matters most.
 */
function RateLine({ a }: { a: SkillAnalytics }) {
  const W = 100;
  const H = 30;
  const x = (i: number) => (i / Math.max(1, a.series.length - 1)) * W;
  const y = (r: number) => H - r * H;

  // Break the line on days with no runs rather than drawing through them, which
  // would invent a slope across a quiet weekend.
  const segments: string[] = [];
  let cur: string[] = [];
  a.series.forEach((d, i) => {
    if (d.rate === null) {
      if (cur.length > 1) segments.push(cur.join(" "));
      cur = [];
    } else {
      cur.push(`${x(i).toFixed(2)},${y(d.rate).toFixed(2)}`);
    }
  });
  if (cur.length > 1) segments.push(cur.join(" "));
  if (segments.length === 0) return null;

  return (
    <div className="border-t border-border px-6 py-5">
      <div className="flex flex-wrap items-baseline gap-y-2">
        <span className="mono text-xs uppercase tracking-[0.13em] text-ink-3">
          Success rate over time
        </span>
        <span className="ml-auto text-sm text-ink-3">
          100% at the top · gaps are days with no runs
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-4 h-24 w-full"
        aria-hidden
      >
        <line x1="0" y1="0" x2={W} y2="0" stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {segments.map((points, i) => (
          <polyline
            key={i}
            points={points}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
}

function Bars({ a }: { a: SkillAnalytics }) {
  const max = Math.max(1, ...a.series.map((d) => d.ok + d.failed + d.needsReview));
  const marks = [0, Math.floor(a.series.length / 2), a.series.length - 1];
  return (
    <>
      {/* Succeeded on top, then review, then failure at the base: a skill going
          wrong reads as ground rising underneath it. */}
      <div className="mt-4 flex h-52 items-end gap-1.5">
        {a.series.map((d) => {
          const total = d.ok + d.failed + d.needsReview;
          return (
            <div
              key={d.ts}
              title={`${d.label}: ${d.ok} succeeded, ${d.needsReview} needed review, ${d.failed} failed`}
              className="flex flex-1 flex-col justify-end overflow-hidden rounded-t-[4px]"
              style={{ height: `${(total / max) * 100}%` }}
            >
              {total > 0 && (
                <>
                  <div className="bg-ink" style={{ height: `${(d.ok / total) * 100}%` }} />
                  <div className="bg-ink-3" style={{ height: `${(d.needsReview / total) * 100}%` }} />
                  <div className="bg-border-strong" style={{ height: `${(d.failed / total) * 100}%` }} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="mono mt-2 flex justify-between text-xs text-ink-3">
        {marks.map((i) => (
          <span key={i}>{a.series[i]?.label}</span>
        ))}
      </div>
    </>
  );
}

export function SkillAnalyticsPanel({
  windows,
  skillName,
  skillId,
}: {
  windows: Record<number, SkillAnalytics>;
  skillName: string;
  skillId: string;
}) {
  const [days, setDays] = useState<number>(30);
  const a = windows[days] ?? windows[30];
  const settled = a.runs;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            aria-pressed={d === days}
            className={
              d === days
                ? "rounded-[var(--radius-base)] bg-ink px-3.5 py-1.5 text-sm font-semibold text-bg"
                : "rounded-[var(--radius-base)] border border-border-strong px-3.5 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
            }
          >
            {d}d
          </button>
        ))}
        <Link
          href={`/skills/${skillId}`}
          prefetch
          className="ml-auto text-sm text-ink-3 underline underline-offset-4 hover:text-ink-2"
        >
          Back to skill
        </Link>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 px-6 py-4">
          <span className="font-semibold tracking-tight">{skillName}</span>
          <span className="mono ml-auto text-sm text-ink-3">
            Last {a.days} days
            {a.inFlight > 0 ? ` · ${num(a.inFlight)} still running` : ""}
          </span>
        </div>

        <div className="grid sm:grid-cols-4">
          <Tile label="Runs" value={num(settled)}>
            <Delta now={settled} before={a.previous.runs} unit="runs" />
          </Tile>
          <Tile label="Success rate" value={pct(a.successRate)}>
            <Delta now={a.successRate} before={a.previous.successRate} unit="pt" />
          </Tile>
          <Tile label="Unique users" value={num(a.uniqueUsers)}>
            <span className="text-ink-3">
              {a.repeatUsers > 0 ? `${num(a.repeatUsers)} came back` : "none returned yet"}
            </span>
          </Tile>
          {/* Two different time bases in one tile, so both are labelled. Earned
              moves with the window; unclaimed does not, because a claim settles
              everything outstanding rather than one window of it. Unlabelled,
              a 7-day view showing less earned than claimable reads as a bug. */}
          <Tile label="Earned" value={num(Math.round(a.earned))}>
            <span className="text-ink-3">
              $AEMU in this window · {num(Math.round(a.claimable))} unclaimed all time
            </span>
          </Tile>
        </div>

        <div className="border-t border-border px-6 py-5">
          <div className="flex flex-wrap items-baseline gap-y-2">
            <span className="mono text-xs uppercase tracking-[0.13em] text-ink-3">Runs per day</span>
            <span className="ml-auto flex flex-wrap items-center gap-4 text-sm text-ink-3">
              <span>
                <i className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] bg-ink align-middle" />
                Succeeded
              </span>
              <span>
                <i className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] bg-ink-3 align-middle" />
                Needed review
              </span>
              <span>
                <i className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] bg-border-strong align-middle" />
                Failed
              </span>
            </span>
          </div>
          {settled === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">
              No finished runs in this window yet. Numbers appear here once people start running it.
            </p>
          ) : (
            <Bars a={a} />
          )}
        </div>

        {settled > 0 && <RateLine a={a} />}

        {a.needsReview > 0 && (
          <div className="flex items-start gap-3 border-t border-border px-6 py-4 text-sm text-ink-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-3" />
            <span>
              {num(a.needsReview)} {a.needsReview === 1 ? "run" : "runs"} stopped to ask a person.
              That isn&apos;t a breakage: the skill met something it hadn&apos;t seen and refused to
              guess.
            </span>
          </div>
        )}

        {a.failed > 0 && (
          <div className="flex items-start gap-3 border-t border-border px-6 py-4 text-sm text-ink-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warn" />
            <span>
              {num(a.failed)} of {num(settled)} runs failed outright. A rate that falls usually means
              the page changed, and you&apos;re the only person who can fix it.
            </span>
          </div>
        )}
      </Card>

      {a.stops.length > 0 && (
        <Card className="p-6">
          <Label>Where runs stop</Label>
          <p className="mt-2 text-sm text-ink-2">
            The last step reached by runs that didn&apos;t complete. This is where they got to, which
            is usually — but not always — the step that needs fixing.
            {a.stopsTruncated && " Showing the five most common; there were others."}
          </p>
          <div className="mt-4 grid gap-2">
            {a.stops.map((sp) => (
              <div
                key={`${sp.idx}-${sp.intent}`}
                className="flex items-center gap-4 rounded-[var(--radius-base)] border border-border bg-surface-2 px-4 py-3"
              >
                <span className="mono shrink-0 text-sm text-ink-3">
                  {sp.idx < 0 ? "start" : `step ${sp.idx + 1}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {sp.idx < 0
                    ? "Never reached the first step — the page or the browser didn't come up"
                    : sp.intent || "(no description)"}
                </span>
                <span className="mono shrink-0 text-sm tabular-nums">
                  {num(sp.stops)} {sp.stops === 1 ? "run" : "runs"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {a.byVersion.length > 0 && (
        <Card className="p-6">
          <Label>By version</Label>
          <p className="mt-2 text-sm text-ink-2">
            Skills change, and they heal themselves. If a rate dropped, this is where you find out
            which version it dropped on.
          </p>
          <div className="mt-4 grid gap-2">
            {a.byVersion.map((v) => (
              <div
                key={String(v.version)}
                className="flex items-center gap-4 rounded-[var(--radius-base)] border border-border bg-surface-2 px-4 py-3"
              >
                <span className="mono shrink-0 text-sm">
                  {v.version === null ? "unrecorded" : `v${v.version}`}
                </span>
                <span className="min-w-0 flex-1 text-sm text-ink-3">
                  {v.version === null
                    ? `${num(v.runs)} runs from before versions were tracked`
                    : `${num(v.runs)} runs`}
                </span>
                <span className="mono shrink-0 text-sm tabular-nums">{pct(v.rate)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <Label>Operator cost</Label>
        <p className="mt-2 text-sm text-ink-2">
          {num(a.tokensIn)} tokens in · {num(a.tokensOut)} out across {num(settled)}{" "}
          {settled === 1 ? "run" : "runs"} in this window. What the model spent deciding what to do,
          shown so income can be read next to what it cost to produce.
        </p>
      </Card>
    </div>
  );
}
