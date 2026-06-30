"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Brand } from "@/components/Nav";
import { Button } from "@/components/ui";

/**
 * Route error boundary. A transient failure during a server-component render
 * (e.g. a brief DB/RPC hiccup) shows a friendly retry instead of an unstyled
 * crash. `reset()` re-renders the segment.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced server-side via logError already; log on the client too.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="py-6">
        <Link href="/" aria-label="Home">
          <Brand />
        </Link>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-24 text-center">
        <div className="mono text-5xl font-semibold tracking-tight text-ink-2">
          Something broke
        </div>
        <p className="max-w-sm text-ink-2">
          We couldn&apos;t load this page. It&apos;s usually a transient hiccup -
          try again.
        </p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Link href="/">
            <Button variant="default">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
