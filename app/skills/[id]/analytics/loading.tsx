import { Card } from "@/components/ui";
import { Nav } from "@/components/Nav";

/**
 * Shown while the three windows are queried. Without it the whole page stays on
 * the previous screen until every query lands, which reads as a frozen click
 * rather than a slow one.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1.5 text-sm text-ink-2">Reading this skill&apos;s runs…</p>
        <div className="mt-6 grid gap-4">
          <Card className="overflow-hidden p-0">
            <div className="h-14 border-b border-border bg-surface-2" />
            <div className="grid sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="border-b border-border px-6 py-5 sm:border-b-0 sm:border-r sm:last:border-r-0">
                  <div className="h-3 w-20 rounded bg-surface-2" />
                  <div className="mt-3 h-8 w-24 rounded bg-surface-2" />
                  <div className="mt-3 h-3 w-28 rounded bg-surface-2" />
                </div>
              ))}
            </div>
            <div className="border-t border-border px-6 py-5">
              <div className="h-52 rounded bg-surface-2" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
