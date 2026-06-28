import { tokenLaunched } from "@/lib/solana";

/** Thin global strip during pre-launch so the token-gated bits read on purpose. */
export function TokenBanner() {
  if (tokenLaunched()) return null;
  return (
    <div className="border-b border-border bg-surface-2 px-6 py-2 text-center text-xs text-ink-2">
      <span className="mono mr-2 rounded-full border border-border-strong px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
        Pre-launch
      </span>
      $AEMU isn&apos;t live yet — everything is free to use. The token launches
      soon on pump.fun.
    </div>
  );
}
