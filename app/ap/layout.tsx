import Link from "next/link";
import { DEMO_ORG, DEMO_ACTOR } from "@/lib/ap-controls/demo";
import { loadConnection } from "@/lib/qbo/oauth";

// A quiet control-surface header — no token banner, no global nav. Flat
// background (bg-bg) paints over the site's dotted grid so this reads as a
// ledger environment, not a design canvas.
export default async function ApLayout({ children }: { children: React.ReactNode }) {
  const conn = await loadConnection().catch(() => null);
  const connected = !!conn && conn.status === "connected" && !!conn.accessToken;

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-6 py-3 text-sm">
        <Link href="/ap/queue" className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">Aemulus</span>
          <span className="text-ink-3">·</span>
          <span className="text-ink-2">{DEMO_ORG}</span>
        </Link>
        <div className="flex items-center gap-3 text-ink-3">
          {connected ? (
            <span className="text-ink-2">QuickBooks connected</span>
          ) : (
            <a href="/api/qbo/connect" className="text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80">
              Connect QuickBooks
            </a>
          )}
          <span>·</span>
          <span>{DEMO_ACTOR.name}</span>
          <span>·</span>
          <span className="text-ink-2">🔒 Sealed audit on</span>
        </div>
      </header>
      {children}
    </div>
  );
}
