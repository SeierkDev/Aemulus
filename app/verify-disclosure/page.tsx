import Link from "next/link";
import { Label } from "@/components/ui";
import { DisclosureVerifier } from "@/components/DisclosureVerifier";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus — Verify a disclosure",
  description:
    "Verify a selective-disclosure proof: confirm one field of a run against its on-chain-anchored commitment, without revealing anything else.",
};

export default function VerifyDisclosurePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          aemulus
        </Link>
        <Label>Selective disclosure</Label>
      </header>

      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Prove one fact. Reveal nothing else.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
          Every run is committed as a hiding Merkle root over its fields and
          anchored on Solana. The owner can disclose a single field — an output,
          an input — with a proof that anyone can check against that root, while
          every other field stays private. Paste a disclosure below to verify it.
        </p>

        <div className="mt-6">
          <DisclosureVerifier />
        </div>

        <p className="mt-6 text-xs text-ink-3">
          Run owners generate a disclosure from the run&apos;s page. The verifier
          binds the proof to its run automatically — a valid result means the
          field belongs to that run&apos;s committed root, not just to some root the
          bundle carries. Cross-check the run itself at{" "}
          <span className="mono">/verify/&lt;runId&gt;</span> (and its on-chain
          anchor) for full provenance.
        </p>
      </div>
      <div className="py-10" />
    </div>
  );
}
