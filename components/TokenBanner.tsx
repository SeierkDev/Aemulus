import { SOLANA, tokenLaunched } from "@/lib/solana";
import { CopyCa } from "./CopyCa";

/**
 * Thin global strip. Before launch it explains that $AEMU isn't live yet; after
 * launch it stays put and carries the contract address (copyable) plus the
 * pump.fun link, so the CA is one click away from every page.
 */
export function TokenBanner() {
  if (!tokenLaunched()) {
    return (
      <div className="relative z-10 border-b border-border bg-surface-2 px-6 py-2 text-center text-xs text-ink-2">
        <span className="mono mr-2 rounded-full border border-border-strong px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
          Pre-launch
        </span>
        $AEMU isn&apos;t live yet - everything is free to use. The token launches
        soon on pump.fun.
      </div>
    );
  }

  return (
    <div className="relative z-10 border-b border-border bg-surface-2 px-4 py-2 text-xs text-ink-2 sm:px-6">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
        <span className="mono rounded-full border border-border-strong px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink">
          $AEMU
        </span>
        <span className="hidden text-ink-3 sm:inline">CA</span>
        <CopyCa mint={SOLANA.mint} />
        <a
          href={SOLANA.pumpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink underline decoration-border-strong underline-offset-2 transition-opacity hover:opacity-80"
        >
          pump.fun ↗
        </a>
      </div>
    </div>
  );
}
