import Link from "next/link";
import Image from "next/image";
import { Button } from "./ui";
import { MobileNav } from "./MobileNav";
import { XIcon, GitHubIcon } from "./icons";
import { SOLANA } from "@/lib/solana";

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/market", label: "Explore" },
  { href: "/alerts", label: "Alerts" },
  { href: "/skills", label: "Skills" },
  { href: "/runs", label: "Runs" },
  { href: "/earnings", label: "Earnings" },
  { href: "/litepaper", label: "Litepaper" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/developers", label: "Developers" },
];

/** The Aemulus mark. */
export function Brand() {
  return (
    <Image
      src="/aemulus-mark.png"
      alt="Aemulus"
      width={50}
      height={36}
      priority
    />
  );
}

/** Shared top bar for the app's primary surfaces. */
export function Nav() {
  return (
    <>
      {/* Phone: brand + hamburger (sections open in a dropdown). */}
      <header className="flex items-center justify-between py-4 sm:hidden">
        <Link href="/" aria-label="Home">
          <Brand />
        </Link>
        <MobileNav links={NAV_LINKS} xUrl={SOLANA.xUrl} githubUrl={SOLANA.githubUrl} />
      </header>

      {/* Desktop / tablet: full inline nav. */}
      <header className="hidden py-6 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <Link href="/" aria-label="Home" className="sm:justify-self-start">
          <Brand />
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-x-5">
          {NAV_LINKS.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-self-end">
          {SOLANA.xUrl && (
            <a
              href={SOLANA.xUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
              className="text-ink-2 transition-colors hover:text-ink"
            >
              <XIcon />
            </a>
          )}
          {SOLANA.githubUrl && (
            <a
              href={SOLANA.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-ink-2 transition-colors hover:text-ink"
            >
              <GitHubIcon />
            </a>
          )}
          <Link href="/record" className="ml-1">
            <Button variant="primary">Record a task</Button>
          </Link>
        </div>
      </header>
    </>
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
