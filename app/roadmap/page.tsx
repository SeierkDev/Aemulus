import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus - Roadmap",
  description: "Where Aemulus is going next.",
};

const ROADMAP = [
  {
    phase: "Phase 1",
    title: "Launch",
    body: [
      "$AEMU goes live on pump.fun; usage gating activates automatically.",
      "On-chain creator payouts - escrow + claim - replace the off-chain earnings ledger.",
      "Receipt roots anchored live on Solana mainnet, with funded signing.",
    ],
  },
  {
    phase: "Phase 2",
    title: "Trust at scale",
    body: [
      "Network-isolated micro-VM sandbox per run, so untrusted marketplace skills can't reach anything they shouldn't.",
      "Permanent receipt + screenshot storage on Arweave - proofs that outlive the app.",
      "Run notifications: email, webhook, and Telegram when a run finishes or needs review.",
      "Marketplace search, categories, and curated collections.",
    ],
  },
  {
    phase: "Phase 3",
    title: "Deeper intelligence",
    body: [
      "Vision-grounded synthesis - the model sees the page, not just the trace.",
      "Full zk-SNARK proofs of execution - today runs already carry private, selective-disclosure receipts (prove any field without revealing the rest); next, prove a whole run followed its skill with zero knowledge.",
      "Waiting, dependent multi-step pipelines across chained skills.",
    ],
  },
  {
    phase: "Phase 4",
    title: "Open ecosystem",
    body: [
      "Public API + SDK to run and compose skills programmatically.",
      "Skill versioning and forking, with full history.",
      "Reputation as a portable, on-chain credential.",
      "Team workspaces and shared skill libraries.",
    ],
  },
  {
    phase: "Phase 5",
    title: "Frontier",
    body: [
      "Multi-chain receipt anchoring.",
      "An on-chain skill registry anyone can build on.",
      "Agents that discover and compose marketplace skills autonomously.",
      "Capture beyond the browser - desktop and mobile.",
    ],
  },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <Nav />

      <section className="border-t border-border pt-14 text-center">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Roadmap
        </Badge>
        <h1 className="mx-auto mt-5 max-w-2xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Where Aemulus is going
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-ink-2">
          Forward-looking. Each phase builds on what&apos;s already live in the
          product today.
        </p>
      </section>

      <section className="py-12">
        <div className="grid gap-3">
          {ROADMAP.map((r) => (
            <Card key={r.phase} className="p-5">
              <div className="flex items-center gap-3">
                <Badge>{r.phase}</Badge>
                <h2 className="text-lg font-semibold tracking-tight">
                  {r.title}
                </h2>
              </div>
              <ul className="mt-3 grid gap-2">
                {r.body.map((b) => (
                  <li key={b} className="flex gap-2.5 text-sm text-ink-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <div className="mt-4 text-xs text-ink-3">
          <Label>Note</Label>
          <p className="mt-1">
            Roadmap items are directional, not commitments, and may change as
            the project and community evolve.
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
