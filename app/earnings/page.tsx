import Link from "next/link";
import { Badge, Button, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth";
import { getEarningsSummary } from "@/lib/earnings";
import { getCreatorAnalytics } from "@/lib/analytics";
import { MiniChart } from "@/components/MiniChart";
import { SOLANA } from "@/lib/solana";
import { when } from "@/lib/format";

export const dynamic = "force-dynamic";


export default async function EarningsPage() {
  const session = await getSession();
  const [summary, analytics] = session
    ? await Promise.all([
        getEarningsSummary(session.pubkey),
        getCreatorAnalytics(session.pubkey),
      ])
    : [null, null];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              You earn {SOLANA.runFee} $AEMU every time someone runs a skill you
              published. Accrues here; on-chain claims arrive at token launch.
            </p>
          </div>
          {summary && <Badge>{summary.runs} paid runs</Badge>}
        </div>

        {!session && (
          <Card className="mt-6 p-8 text-center text-sm text-ink-2">
            Connect your wallet to see your creator earnings.
          </Card>
        )}

        {summary && (
          <>
            {/* Balance */}
            <Card className="mt-6 flex items-center justify-between p-6">
              <div>
                <Label>Accrued balance</Label>
                <div className="mono mt-1 text-4xl font-semibold tracking-tight">
                  {summary.total.toLocaleString()}{" "}
                  <span className="text-lg text-ink-3">$AEMU</span>
                </div>
              </div>
              <div className="text-right">
                <Button variant="default" disabled>
                  Claim (at launch)
                </Button>
                <p className="mt-2 text-xs text-ink-3">
                  Settles on Solana once $AEMU is live.
                </p>
              </div>
            </Card>

            {/* Analytics — last 14 days */}
            {analytics && (
              <Card className="mt-8 p-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <Label>Last 14 days</Label>
                    <div className="mt-2 flex flex-wrap gap-6">
                      <Stat label="Runs" value={String(analytics.windowRuns)} />
                      <Stat
                        label="Success"
                        value={`${Math.round(analytics.windowSuccess * 100)}%`}
                      />
                      <Stat
                        label="$AEMU earned"
                        value={analytics.windowEarnings.toLocaleString()}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <MiniChart
                    caption="Runs / day"
                    values={analytics.days.map((d) => ({
                      label: d.label,
                      value: d.runs,
                    }))}
                  />
                  <MiniChart
                    caption="$AEMU / day"
                    values={analytics.days.map((d) => ({
                      label: d.label,
                      value: d.earnings,
                    }))}
                  />
                </div>
              </Card>
            )}

            {/* Per skill */}
            <div className="mt-8">
              <Label>By skill</Label>
              <div className="mt-3 grid gap-2">
                {summary.bySkill.length === 0 && (
                  <Card className="p-6 text-sm text-ink-3">
                    No earnings yet. Publish a skill so others can run it —{" "}
                    <Link href="/skills" className="text-ink underline">
                      your skills
                    </Link>
                    .
                  </Card>
                )}
                {summary.bySkill.map((s) => (
                  <Link key={s.skillId} href={`/market/${s.skillId}`}>
                    <Card className="flex items-center justify-between p-4 transition-colors hover:bg-surface-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="mono mt-0.5 text-xs text-ink-3">
                          {s.runs} runs
                        </div>
                      </div>
                      <div className="mono text-sm">
                        {s.total.toLocaleString()} $AEMU
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>

            {/* Recent */}
            {summary.recent.length > 0 && (
              <div className="mt-8">
                <Label>Recent</Label>
                <Card className="mt-3 divide-y divide-border">
                  {summary.recent.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="truncate text-ink-2">{r.name}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-ink-3">{when(r.createdAt)}</span>
                        <span className="mono text-ink">
                          +{r.amount.toLocaleString()}
                        </span>
                      </span>
                    </div>
                  ))}
                </Card>
              </div>
            )}
          </>
        )}
      </div>
      <div className="py-10" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-ink-3">{label}</div>
    </div>
  );
}
