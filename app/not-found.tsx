import Link from "next/link";
import { Brand } from "@/components/Nav";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="py-6">
        <Link href="/" aria-label="Home">
          <Brand />
        </Link>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-24 text-center">
        <div className="mono text-6xl font-semibold tracking-tight text-ink-2">
          404
        </div>
        <p className="max-w-sm text-ink-2">
          That page doesn&apos;t exist — it may have been a run or skill that was
          removed.
        </p>
        <Link href="/">
          <Button variant="primary">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
