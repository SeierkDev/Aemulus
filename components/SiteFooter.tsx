import Link from "next/link";
import { SOLANA } from "@/lib/solana";
import { TELEGRAM_CHANNEL_URL, TELEGRAM_COMMUNITY_URL } from "@/lib/telegram-links";

/** Shared site footer for the landing surfaces. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mono text-sm font-semibold">aemulus</div>
          <div className="mt-1 text-xs text-ink-3">show once · run forever</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
          <Link href="/litepaper" className="hover:text-ink">
            Litepaper
          </Link>
          <Link href="/roadmap" className="hover:text-ink">
            Roadmap
          </Link>
          <Link href="/developers" className="hover:text-ink">
            Developers
          </Link>
          <Link href="/market" className="hover:text-ink">
            Marketplace
          </Link>
          <Link href="/vault" className="hover:text-ink">
            Vault
          </Link>
          <Link href="/org" className="hover:text-ink">
            Teams
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          {SOLANA.xUrl && (
            <a href={SOLANA.xUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              X
            </a>
          )}
          <a
            href={TELEGRAM_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink"
          >
            Telegram
          </a>
          <a
            href={TELEGRAM_COMMUNITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink"
          >
            Community
          </a>
          {SOLANA.githubUrl && (
            <a href={SOLANA.githubUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              GitHub
            </a>
          )}
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <span className="mono text-xs text-ink-3">
          $AEMU CA: {SOLANA.mint || "TBA - launching on pump.fun"}
        </span>
      </div>
    </footer>
  );
}
