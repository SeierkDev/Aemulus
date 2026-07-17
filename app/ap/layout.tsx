import Link from "next/link";
import { loadConnection } from "@/lib/qbo/oauth";
import { getApSession } from "@/lib/ap-controls/ap-session";
import { LogoutButton } from "@/components/ap/LogoutButton";

// A quiet control-surface header — no token banner, no global nav. Flat
// background (bg-bg) paints over the site's dotted grid so this reads as a
// ledger environment, not a design canvas.
export default async function ApLayout({ children }: { children: React.ReactNode }) {
  const session = await getApSession();
  const conn = session ? await loadConnection(session.workspaceId).catch(() => null) : null;
  const connected = !!conn && conn.status === "connected" && !!conn.accessToken;

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-6 py-3 text-sm">
        <Link href={session ? "/ap/queue" : "/ap/login"} className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">Aemulus</span>
          {session && (
            <>
              <span className="text-ink-3">·</span>
              <span className="text-ink-2">{session.name}</span>
            </>
          )}
        </Link>
        {session && (
          <div className="flex items-center gap-3 text-ink-3">
            {connected ? (
              <span className="text-ink-2">QuickBooks connected</span>
            ) : (
              <a href="/api/qbo/connect" className="text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80">
                Connect QuickBooks
              </a>
            )}
            <span>·</span>
            <Link href="/ap/billing" className="text-ink-3 hover:text-ink">Billing</Link>
            <span>·</span>
            <span className="text-ink-2">🔒 Sealed audit on</span>
            <span>·</span>
            <LogoutButton />
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
