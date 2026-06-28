import Link from "next/link";
import { Badge, Card, Label } from "@/components/ui";
import { verifyReceipt } from "@/lib/receipt";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const v = await verifyReceipt(runId);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          aemulus
        </Link>
        <Label>Receipt verification</Label>
      </header>

      {!v.found ? (
        <Card className="p-6">
          <h1 className="text-lg font-semibold tracking-tight">
            No receipt found
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            No run with a recorded receipt matches{" "}
            <span className="mono text-ink">{runId}</span>.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {/* Integrity verdict */}
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold tracking-tight">
                {v.matches ? "Receipt verified" : "Receipt mismatch"}
              </h1>
              <Badge className="text-ink">
                {v.matches ? "✓ intact" : "✗ altered"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              {v.matches
                ? "The run's stored data and proof screenshots still hash to the recorded receipt — nothing has been altered since it ran."
                : "The recomputed hash does NOT match the recorded receipt. This run's data or screenshots have changed since it ran."}
            </p>
            <div className="mt-4 grid gap-1.5 text-sm">
              <Row k="run" v={v.runId} mono />
              <Row k="status" v={String(v.status)} />
              <Row k="steps" v={String(v.steps)} />
            </div>
            <div className="mt-4">
              <Label>Receipt hash (sha256)</Label>
              <div className="mono mt-1 break-all text-xs text-ink-2">
                {v.hash}
              </div>
            </div>
          </Card>

          {/* On-chain anchor */}
          <Card className="p-6">
            <Label>On-chain anchor</Label>
            {v.anchor ? (
              <div className="mt-2 text-sm text-ink-2">
                <p>
                  {v.anchor.memoMatches === true
                    ? "Confirmed on Solana — the anchored memo carries this exact hash."
                    : v.anchor.memoMatches === false
                      ? "Anchored, but the on-chain memo did not match (investigate)."
                      : "Anchored on Solana. Could not reach an RPC to read it back right now."}
                </p>
                <a
                  href={v.anchor.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs text-ink hover:underline"
                >
                  View transaction on explorer →
                </a>
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-3">
                Not yet anchored — on-chain anchoring activates at launch. The
                integrity check above is independent of the chain.
              </p>
            )}
          </Card>

          <p className="text-center text-xs text-ink-3">
            Anyone can verify this receipt — no sign-in, no private data exposed.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="mono w-16 shrink-0 text-ink-3">{k}</span>
      <span className={mono ? "mono break-all text-ink" : "text-ink"}>{v}</span>
    </div>
  );
}
