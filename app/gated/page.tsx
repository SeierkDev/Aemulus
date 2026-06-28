import { Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth";
import { SOLANA } from "@/lib/solana";

export const dynamic = "force-dynamic";

export default async function GatedPage() {
  const session = await getSession();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="flex flex-1 flex-col items-center justify-center py-24">
        <Card className="w-full max-w-md p-8 text-center">
          <Label>Token-gated</Label>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Hold $AEM to enter
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Aemulus is open to $AEM holders. Your wallet is connected — you just
            need at least{" "}
            <span className="text-ink">
              {SOLANA.holderMin.toLocaleString()} $AEM
            </span>{" "}
            to unlock recording, skills, and runs.
          </p>

          {session && (
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-base)] border border-border bg-border text-left">
              <div className="bg-surface p-3">
                <div className="mono text-[0.65rem] uppercase tracking-wide text-ink-3">
                  Your balance
                </div>
                <div className="mt-1 mono text-lg">
                  {session.balance.toLocaleString()}
                </div>
              </div>
              <div className="bg-surface p-3">
                <div className="mono text-[0.65rem] uppercase tracking-wide text-ink-3">
                  Required
                </div>
                <div className="mt-1 mono text-lg">
                  {SOLANA.holderMin.toLocaleString()}
                </div>
              </div>
            </div>
          )}

          <a href={SOLANA.pumpUrl} target="_blank" rel="noopener noreferrer">
            <span className="mt-6 inline-flex w-full items-center justify-center rounded-[var(--radius-base)] bg-signal px-3.5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-ink">
              Get $AEM on pump.fun →
            </span>
          </a>
          <p className="mt-3 text-xs text-ink-3">
            Already bought? Sign out and back in to refresh your balance.
          </p>
        </Card>
      </div>
    </div>
  );
}
