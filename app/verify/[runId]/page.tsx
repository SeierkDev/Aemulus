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
                ? "The run's stored data and proof screenshots still hash to the recorded receipt - nothing has been altered since it ran."
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

          {/* Merkle batch membership */}
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <Label>Merkle batch anchor</Label>
              {v.batch && (
                <Badge className="text-ink">
                  {v.batch.proofValid ? "✓ in batch" : "✗ not in batch"}
                </Badge>
              )}
            </div>
            {v.batch ? (
              <div className="mt-2 text-sm text-ink-2">
                <p>
                  {v.batch.proofValid
                    ? `This run is leaf #${v.batch.index} of a batch of ${v.batch.leafCount}. Its Merkle proof resolves to the batch root - independently confirmed.`
                    : "The Merkle proof does NOT resolve to the batch root for this run's data."}
                </p>
                <div
                  className="mono mt-3 break-all text-xs text-ink-3"
                  title={v.batch.root}
                >
                  root: {v.batch.root}
                </div>
                <a
                  href={`/api/batch/${v.batch.id}/bundle`}
                  className="mt-2 inline-block text-xs text-ink hover:underline"
                >
                  Download proof bundle ↓
                </a>
                <span className="ml-2 text-xs text-ink-3">
                  self-contained · verifiable offline
                </span>
                {v.batch.anchor ? (
                  <p className="mt-2">
                    {v.batch.anchor.memoMatches === true
                      ? "The batch root is anchored on Solana - confirmed on-chain."
                      : v.batch.anchor.memoMatches === false
                        ? "Anchored, but the on-chain memo did not match (investigate)."
                        : "Anchored on Solana. Could not reach an RPC to read it back right now."}{" "}
                    <a
                      href={v.batch.anchor.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink hover:underline"
                    >
                      View on explorer →
                    </a>
                  </p>
                ) : (
                  <p className="mt-2 text-ink-3">
                    Root recorded; on-chain anchoring activates at launch.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-3">
                Awaiting the next Merkle batch - its proof appears here once
                anchored. The integrity check above is independent of the chain.
              </p>
            )}
          </Card>

          {v.commitmentRoot && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Private commitment</h2>
              <p className="mt-2 text-sm text-ink-2">
                This run is also committed as a hiding Merkle root over its
                fields. The owner can prove any single fact (an output, an input)
                against this root without revealing the rest - selective
                disclosure, verifiable by anyone.
              </p>
              <code className="mono mt-2 block truncate text-xs text-ink-3">
                {v.commitmentRoot}
              </code>
              <Link
                href="/verify-disclosure"
                className="mt-3 inline-block text-xs text-ink hover:underline"
              >
                Verify a disclosure →
              </Link>
            </Card>
          )}

          <p className="text-center text-xs text-ink-3">
            Anyone can verify this receipt - no sign-in, no private data exposed.
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
