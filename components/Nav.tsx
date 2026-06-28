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
    <header className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
      <Link href="/" aria-label="Home">
        <Brand />
      </Link>
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-5">
        <NavLink href="/market">Explore</NavLink>
        <NavLink href="/skills">Skills</NavLink>
        <NavLink href="/runs">Runs</NavLink>
        <NavLink href="/earnings">Earnings</NavLink>
        <NavLink href="/litepaper">Litepaper</NavLink>
        <NavLink href="/roadmap">Roadmap</NavLink>
        <Link href="/record" className="ml-1">
          <Button variant="primary">Record a task</Button>
        </Link>
        <WalletStatus />
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm text-ink-2 transition-colors hover:text-ink"
    >
      {children}
    </Link>
  );
}
