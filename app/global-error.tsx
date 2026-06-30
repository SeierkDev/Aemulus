"use client";

import "./globals.css";

/**
 * Last-resort boundary for a failure in the root layout itself (rare). It must
 * render its own <html>/<body> because it replaces the layout.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="text-2xl font-semibold">Something broke</div>
        <p className="max-w-sm opacity-70">
          The app hit an unexpected error. Try again.
        </p>
        <button
          onClick={reset}
          className="rounded border px-4 py-2 text-sm"
          type="button"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
