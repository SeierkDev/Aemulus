"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "./ui";
import { XIcon, GitHubIcon } from "./icons";

type NavItem = { href: string; label: string };

/** Phone nav: a hamburger button that opens a dropdown panel of the sections,
 *  so they don't pile up on top of each other on a narrow screen. */
export function MobileNav({
  links,
  xUrl,
  githubUrl,
}: {
  links: NavItem[];
  xUrl?: string;
  githubUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-base)] border border-border-strong bg-surface-2 text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden>
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M3 6h18" />
              <path d="M3 12h18" />
              <path d="M3 18h18" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <>
          {/* Tap-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-12 z-50 w-60 rounded-[var(--radius-base)] border border-border-strong bg-surface p-2 shadow-2xl">
            <nav className="flex flex-col">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  className="rounded-md px-3 py-2.5 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            <Link href="/record" onClick={close} className="mt-2 block px-1">
              <Button variant="primary" className="w-full">
                Record a task
              </Button>
            </Link>

            {(xUrl || githubUrl) && (
              <div className="mt-3 flex items-center gap-4 border-t border-border px-3 pt-3">
                {xUrl && (
                  <a
                    href={xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="X (Twitter)"
                    className="text-ink-2 transition-colors hover:text-ink"
                  >
                    <XIcon />
                  </a>
                )}
                {githubUrl && (
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub"
                    className="text-ink-2 transition-colors hover:text-ink"
                  >
                    <GitHubIcon />
                  </a>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
