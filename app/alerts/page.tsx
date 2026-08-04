import Link from "next/link";
import { Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { WalletGate } from "@/components/WalletGate";
import { getSession } from "@/lib/auth";
import { getQuota } from "@/lib/quota";
import { chatsForOwner } from "@/lib/telegram";
import { ALERT_PRESETS } from "@/lib/alert-pack";
import { affordableCadences, cadenceLabel, CHECKS_PER_DAY } from "@/lib/schedules";
import { botUrl } from "@/lib/telegram-links";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus - Alerts",
  description: "Pick what you want to know about. Get told the moment it changes.",
};

/**
 * The front door for people who will never record a task.
 *
 * Everything here already existed as machinery — schedules, watches, thresholds,
 * Telegram delivery. What did not exist was a way in that does not begin with
 * "record a task by demonstrating it", which is why almost nobody reached it.
 */
export default async function AlertsPage() {
  const session = await getSession();
  const [quota, chats] = session
    ? await Promise.all([getQuota(session, "watch"), chatsForOwner(session.pubkey)])
    : [null, []];

  const allowance = quota?.unlimited ? -1 : (quota?.limit ?? 0);
  const affordable = new Set(affordableCadences(allowance));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
          Pick what you want to know about. Aemulus checks the page for you and
          messages you on Telegram the moment it changes. No recording, no setup.
        </p>

        {/* Said before anything is tapped, not after: a cadence somebody cannot
            sustain used to be accepted and then silently skipped. */}
        {quota && (
          <Card className="mt-6 p-5">
            <Label>Your checking allowance</Label>
            <p className="mt-2 text-sm text-ink-2">
              {quota.unlimited
                ? "Unlimited checks. Every schedule below is available."
                : `${quota.limit} checks a day on the ${quota.tier} tier, ${quota.remaining} left right now. That covers ${
                    affordable.size > 0
                      ? `checking as often as ${cadenceLabel(
                          [...affordable][0],
                        ).toLowerCase()}`
                      : "nothing yet"
                  }.`}
            </p>
            {!quota.unlimited && (
              <p className="mt-2 text-sm text-ink-3">
                Checks are metered separately from runs, so a watch never eats the
                runs you wanted for actual work.
              </p>
            )}
          </Card>
        )}

        <WalletGate
          signedIn={!!session}
          hint="Connect your wallet to turn alerts on. They're tied to your wallet, not to a browser."
        >
          {chats.length === 0 && (
            <Card className="mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">Connect Telegram first</div>
                <p className="mt-1 text-sm text-ink-2">
                  Alerts arrive there. It takes about a minute.
                </p>
              </div>
              <div className="flex shrink-0 gap-3">
                <a
                  href={botUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-[var(--radius-base)] bg-ink px-5 py-2.5 text-sm font-semibold text-bg"
                >
                  Open the bot
                </a>
                <Link
                  href="/link"
                  className="rounded-[var(--radius-base)] border border-border-strong px-5 py-2.5 text-sm text-ink-2 hover:text-ink"
                >
                  Connect
                </Link>
              </div>
            </Card>
          )}

          <div className="mt-4 grid gap-3">
            {ALERT_PRESETS.map((p) => {
              const canAfford = affordable.has(p.suggested);
              const ready = !!p.skillId;
              return (
                <Card key={p.id} className="flex items-center justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <div className="font-medium">{p.title}</div>
                    <div className="mt-1 text-sm text-ink-3">{p.detail}</div>
                    <div className="mono mt-2 text-xs text-ink-3">
                      {cadenceLabel(p.suggested)} · {CHECKS_PER_DAY[p.suggested]} checks a day
                      {!canAfford && ready ? " · more than your tier covers" : ""}
                    </div>
                  </div>
                  {/* Either a real destination or an honest label. A control
                      that looks live and does nothing is the trap the
                      marketplace templates fell into. The wizard lives in the
                      bot, so this hands the choice over rather than
                      reimplementing it here. */}
                  {ready && canAfford ? (
                    <a
                      href={`${botUrl()}?start=alert_${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-[var(--radius-base)] bg-ink px-4 py-2 text-sm font-semibold text-bg"
                    >
                      Turn on
                    </a>
                  ) : (
                    <span className="shrink-0 rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-4 py-2 text-sm text-ink-3">
                      {!ready ? "Coming soon" : "Needs a higher tier"}
                    </span>
                  )}
                </Card>
              );
            })}
          </div>

          <p className="mt-6 text-sm text-ink-3">
            Want something that isn&apos;t here? Record it once and it becomes a
            watch like any other. <Link href="/record" className="text-ink underline underline-offset-4">Record a task →</Link>
          </p>
        </WalletGate>
      </div>
      <SiteFooter />
    </div>
  );
}
