import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { Reveal } from "@/components/Reveal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus - Roadmap",
  description: "Where Aemulus is going next.",
};

/** A roadmap line. `done` marks something that has actually shipped. */
type Item = { t: string; done?: boolean };

const ROADMAP: { phase: string; title: string; body: Item[] }[] = [
  {
    phase: "Phase 1",
    title: "Launch",
    body: [
      {
        t: "$AEMU goes live on pump.fun; usage gating activates automatically.",
        done: true,
      },
      {
        t: "On-chain creator payouts - escrow + claim - replace the off-chain earnings ledger.",
      },
      { t: "Receipt roots anchored live on Solana mainnet, with funded signing." },
    ],
  },
  {
    phase: "Phase 2",
    title: "Trust at scale",
    body: [
      // Split deliberately. What shipped is process-level isolation, not a
      // micro-VM, and the two are not the same boundary — claiming the stronger
      // one because the weaker one landed would be exactly the kind of thing
      // this feature exists to make checkable.
      {
        t: "Isolated execution: every run gets its own browser process and profile, plus a network boundary that only lets it reach the hosts its skill declared. The policy each run executed under is recorded in its receipt.",
        done: true,
      },
      {
        t: "Micro-VM isolation per run: a run's browser executes inside a VM with its own kernel, adding a kernel-level boundary beneath the process-level one. Which boundary a run actually got is recorded in its receipt rather than assumed, and there is a mode that refuses to run at all rather than quietly fall back to the weaker one.",
        done: true,
      },
      // Split for the same reason as the isolation entry above. What ships is
      // the batch bundle - the Merkle root, every leaf hash and every proof -
      // which is what makes a receipt verifiable offline. The screenshots
      // themselves are still ours: the bundle proves what a screenshot hashed
      // to, not what it looked like.
      {
        t: "Permanent receipt storage on Arweave: each batch's proof bundle is written to permanent storage, readable by anyone at a public gateway with no account and no help from us - so a receipt stays checkable even if this app is gone.",
        done: true,
      },
      {
        t: "Permanent screenshot storage on Arweave, so the evidence a receipt points at outlives the app too, not just the hashes that prove it. Opt-in per run: permanent storage is public and has no delete, and a run's screenshots are yours until you decide otherwise.",
        done: true,
      },
      // Split, and email dropped. Sign-in is a wallet, so there is no address
      // to send to; adding one would mean collecting and verifying personal
      // data this product deliberately does not hold. Telegram covers the same
      // need without any of it.
      {
        t: "Telegram watches: turn any page into an alert, including pages behind your login, because a watch replays a skill you recorded while signed in. Set one up in three taps and it stays quiet until the value changes.",
        done: true,
      },
      {
        t: "Alerts for ordinary runs too, not only watches, so a finished or failed run can reach you the same way (signed webhooks are already live today).",
        done: true,
      },
      {
        t: "A creator analytics dashboard: per skill, how often it runs, how often it succeeds, how many distinct people use it, what it has earned and what it cost to run, over a window you choose. Counts only, never who ran what.",
        done: true,
      },
      {
        t: "Curated collections and editorial spotlights, so what is worth running is in front of you when you land instead of behind a search box you have to know what to type into. Full-text search and auto-categories already shipped.",
        done: true,
      },
    ],
  },
  {
    phase: "Phase 3",
    title: "Deeper intelligence",
    body: [
      {
        t: "Vision-grounded synthesis - the generalizer sees the recording's screenshots alongside the trace, so it can tell near-identical elements apart and read what a value actually was, instead of inferring intent from element names alone.",
        done: true,
      },
      {
        t: "Full zk-SNARK proofs of execution - today runs already carry private, selective-disclosure receipts (prove any field without revealing the rest); next, prove a whole run followed its skill with zero knowledge.",
      },
      {
        t: "Longer, branching multi-step pipelines with waits and conditionals - single-level skill chaining that passes one skill's outputs into another's inputs already ships today.",
      },
    ],
  },
  {
    phase: "Phase 4",
    title: "Open ecosystem",
    body: [
      {
        t: "A published, versioned SDK package and additional language clients (the REST API, OpenAPI spec, in-repo TypeScript SDK, and MCP server are live today).",
      },
      { t: "Skill forking and remixing across creators (versioning with full history already ships)." },
      { t: "Reputation as a portable, on-chain credential." },
      { t: "Richer team roles + shared run history (basic teams with shared skills already ship)." },
    ],
  },
  {
    phase: "Phase 5",
    title: "Frontier",
    body: [
      { t: "Multi-chain receipt anchoring." },
      { t: "An on-chain skill registry anyone can build on." },
      { t: "Agents that discover and compose marketplace skills autonomously." },
      {
        t: "Capture beyond the browser - desktop and mobile (the browser extension, which runs skills in your own logged-in browser, already ships today).",
      },
    ],
  },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
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
          product today. Anything marked shipped is running right now.
        </p>
      </section>

      <section className="py-14">
        {/* Alternating timeline: a spine down the middle (left rail on mobile),
            phase cards zig-zagging left/right, each pinned to a node on the line. */}
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute top-2 bottom-2 left-[7px] w-px bg-border md:left-1/2 md:-translate-x-1/2"
          />
          <div className="grid gap-10 md:gap-14">
            {ROADMAP.map((r, i) => {
              const left = i % 2 === 0;
              return (
                <Reveal
                  key={r.phase}
                  className="relative md:grid md:grid-cols-2 md:items-start md:gap-12"
                >
                  {/* node on the spine */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-4 z-10 h-4 w-4 rounded-full border-4 border-bg bg-ink md:left-1/2 md:-translate-x-1/2"
                  />
                  <div
                    className={
                      "pl-8 md:pl-0 " +
                      (left
                        ? "md:col-start-1 md:pr-12 md:text-right"
                        : "md:col-start-2 md:pl-12")
                    }
                  >
                    <Card className="p-5">
                      <div
                        className={
                          "flex items-center gap-3 " +
                          (left ? "md:flex-row-reverse" : "")
                        }
                      >
                        <Badge>{r.phase}</Badge>
                        <h2 className="text-lg font-semibold tracking-tight">
                          {r.title}
                        </h2>
                      </div>
                      <ul className="mt-3 grid gap-2">
                        {r.body.map((b) => (
                          <li
                            key={b.t}
                            className={
                              "flex gap-2.5 text-sm " +
                              (b.done ? "text-ink " : "text-ink-2 ") +
                              (left ? "md:flex-row-reverse md:text-right" : "")
                            }
                          >
                            {b.done ? (
                              <span
                                aria-hidden
                                className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border-strong text-[9px] leading-none text-ink"
                              >
                                ✓
                              </span>
                            ) : (
                              <span
                                aria-hidden
                                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-3"
                              />
                            )}
                            <span className="leading-relaxed">
                              {b.t}
                              {b.done ? (
                                <span className="ml-2 align-middle text-[10px] uppercase tracking-[0.14em] text-ink-3">
                                  Shipped
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
        <div className="mt-8 text-xs text-ink-3">
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
