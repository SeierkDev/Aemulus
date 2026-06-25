import { Nav } from "./Nav";
import { Card } from "./ui";

/** Lightweight loading skeleton shared by list routes. */
export function ListSkeleton({ title }: { title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <div className="h-7 w-32 rounded bg-surface-2" />
        <div className="mt-2 h-4 w-64 rounded bg-surface-2/70" />
        <div className="mt-6 grid gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="h-16 animate-pulse bg-surface-2" />
          ))}
        </div>
        <span className="sr-only">Loading {title}…</span>
      </div>
    </div>
  );
}
