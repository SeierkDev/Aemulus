import { Badge, Card } from "@/components/ui";
import {
  BOT_HANDLE,
  botUrl,
  TELEGRAM_CHANNEL_URL,
  TELEGRAM_COMMUNITY_URL,
} from "@/lib/telegram-links";

/**
 * Home-page nudge for the bot.
 *
 * Watches are set up inside Telegram, which means someone who never opens
 * Telegram has no way to discover the feature exists. This is the only place on
 * the site that says so.
 *
 * The handle comes from lib/telegram so this and the link page can never drift
 * apart and point at different bots.
 */
export function TelegramCallout() {
  return (
    <section id="telegram" className="mt-16 scroll-mt-24">
      <Card className="flex flex-col items-start gap-5 p-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <Badge>
            <span className="h-1.5 w-1.5 rounded-full bg-ink" />
            Telegram bot
          </Badge>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            Get a message the moment a page changes
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Point a skill at any page and Aemulus will keep checking it for you,
            then message you in Telegram when the value you care about is
            different. Because it replays a skill you recorded while signed in,
            it works on pages only you can see - an order status, an invoice, a
            balance, a dashboard behind a login. Connect your wallet to the bot
            and it takes three taps to set one up.
          </p>
        </div>
        {/* BOT_HANDLE always resolves, so there is no "not configured yet"
            state to render here, unlike the extension's store URL. */}
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <a
            href={botUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[var(--radius-base)] bg-ink px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Open @{BOT_HANDLE}
          </a>
          <a
            href="/link"
            className="text-xs text-ink-3 underline underline-offset-4 hover:text-ink-2"
          >
            Or connect your wallet first
          </a>
          {/* Named by what they are for, not by what they are. Three Telegram
              links side by side are easy to confuse, and only one of them is
              where the product actually happens. */}
          <span className="flex items-center gap-3 text-xs text-ink-3">
            <a
              href={TELEGRAM_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-ink-2"
            >
              Announcements
            </a>
            <span aria-hidden>·</span>
            <a
              href={TELEGRAM_COMMUNITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-ink-2"
            >
              Community
            </a>
          </span>
        </div>
      </Card>
    </section>
  );
}
