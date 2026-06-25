import Link from "next/link";
import { Card } from "@/components/ui";

export default function RunsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          ← mimic
        </Link>
      </header>
      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <Card className="mt-6 p-8 text-center">
          <p className="text-sm text-ink-2">
            Autonomous runs arrive in Phase 3 — once skills can execute on new
            inputs.
          </p>
        </Card>
      </div>
    </div>
  );
}
