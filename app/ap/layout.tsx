import Link from "next/link";
import { DEMO_ORG, DEMO_ACTOR } from "@/lib/ap-controls/demo";

// A quiet control-surface header — no token banner, no global nav. Flat
// background (bg-bg) paints over the site's dotted grid so this reads as a
// ledger environment, not a design canvas.
export default function ApLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-6 py-3 text-sm">
        <Link href="/ap/queue" className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">Aemulus</span>
          <span className="text-ink-3">·</span>
          <span className="text-ink-2">{DEMO_ORG}</span>
        </Link>
        <div className="flex items-center gap-3 text-ink-3">
          <span>{DEMO_ACTOR.name}</span>
          <span>·</span>
          <span className="text-ink-2">🔒 Sealed audit on</span>
        </div>
      </header>
      {children}
    </div>
  );
}
