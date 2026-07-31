"use client";

import { useState } from "react";

/** The $AEMU contract address with a one-click copy. Truncated on small screens
 *  so a 44-character address can't blow out the banner on a phone. */
export function CopyCa({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${mint.slice(0, 6)}…${mint.slice(-6)}`;

  return (
    <button
      type="button"
      onClick={() => {
        // Only flip to "copied" if the write actually succeeded.
        navigator.clipboard
          ?.writeText(mint)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => {});
      }}
      title={copied ? "Copied" : `Copy ${mint}`}
      aria-label={copied ? "Contract address copied" : "Copy contract address"}
      className="mono inline-flex max-w-full items-center gap-1.5 rounded border border-border-strong bg-elevated px-2 py-0.5 text-ink-2 transition-colors hover:text-ink"
    >
      <span className="hidden sm:inline">{mint}</span>
      <span className="sm:hidden">{short}</span>
      <span className="text-ink-3">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
