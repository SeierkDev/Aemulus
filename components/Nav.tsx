import Link from "next/link";
import { Button } from "./ui";
import { WalletStatus } from "./WalletStatus";
import { SOLANA } from "@/lib/solana";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.51 11.51 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

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
        <a
          href={SOLANA.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="text-ink-2 transition-colors hover:text-ink"
        >
          <GitHubIcon />
        </a>
        <a
          href={SOLANA.xUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X (Twitter)"
          className="text-ink-2 transition-colors hover:text-ink"
        >
          <XIcon />
        </a>
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
