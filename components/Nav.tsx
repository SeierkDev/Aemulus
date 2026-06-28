import Link from "next/link";
import { Button } from "./ui";
import { WalletStatus } from "./WalletStatus";

/** The Aemulus mark — two nested squares (the original and its copy). */
export function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-md border border-border-strong bg-surface-2">
        <span className="relative h-3.5 w-3.5">
          <span className="absolute inset-0 rounded-[3px] border border-ink-2" />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-[3px] border border-ink bg-bg" />
        </span>
      </span>
      <span className="mono text-sm font-semibold tracking-tight">aemulus</span>
    </span>
  );
}

/** Shared top bar for the app's primary surfaces. */
export function Nav() {
  return (
    <header className="flex items-center justify-between py-6">
      <Link href="/" aria-label="Home">
        <Brand />
      </Link>
      <nav className="flex items-center gap-1">
        <Link href="/market">
          <Button variant="ghost">Explore</Button>
        </Link>
        <Link href="/skills">
          <Button variant="ghost">Skills</Button>
        </Link>
        <Link href="/runs">
          <Button variant="ghost">Runs</Button>
        </Link>
        <Link href="/earnings">
          <Button variant="ghost">Earnings</Button>
        </Link>
        <Link href="/record">
          <Button variant="primary">Record a task</Button>
        </Link>
        <WalletStatus />
      </nav>
    </header>
  );
}
