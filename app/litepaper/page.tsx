import Link from "next/link";
import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { BuyAemu } from "@/components/BuyAemu";
import { SiteFooter } from "@/components/SiteFooter";
import { SOLANA } from "@/lib/solana";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus - Litepaper",
  description: "What Aemulus is, how $AEMU works, and where it's going.",
};

const LIVE_TODAY = [
  ["Teach by demonstration", "Record a browser task once; Claude generalizes it into a reusable, parameterized skill."],
  ["Multi-demo synthesis", "Record the same task a few times and Aemulus learns what varies vs what's fixed - verified against every demo."],
  ["Calibrated autonomy", "Every step carries a confidence score; uncertain steps pause for review instead of guessing."],
  ["Proof on every run", "Each step is screenshotted, and each run gets a tamper-evident receipt."],
  ["Private verifiable receipts", "Run receipts are committed to a Merkle root and anchored on-chain - anyone can verify a run, and the owner can prove any single field (an output, an input) without revealing the rest."],
  ["Bulk execution", "Upload a CSV and run a skill across hundreds of rows; export the results."],
  ["Structured extraction", "Capture values off the page into typed outputs and download them as CSV."],
  ["A skill marketplace", "Publish skills, run others', with reputation from real run outcomes and verified ratings."],
  ["Self-running economy", "Schedule skills to run autonomously; creators accrue earnings when others run their skills."],
];

const TIERS = [
  { name: "Holder", min: SOLANA.holderMin, quota: SOLANA.quotaHolder },
  { name: "Pro", min: SOLANA.proMin, quota: SOLANA.quotaPro },
  { name: "Whale", min: SOLANA.whaleMin, quota: SOLANA.quotaWhale },
];

function quotaLabel(q: number): string {
  return q < 0 ? "Unlimited runs / day" : `${q} runs / day`;
}

export default function LitepaperPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <Nav />

      {/* Header */}
      <section className="border-t border-border pt-14">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Litepaper · v1
        </Badge>
        <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Show it once. Run it forever.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-2">
          Aemulus turns a single browser demonstration into an autonomous,
          verifiable skill - and a marketplace where those skills earn. $AEMU is
          the usage layer that powers it.
        </p>
      </section>

      {/* Problem */}
      <section className="border-t border-border py-14">
        <Label>The problem</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Repetitive browser work is everywhere - and brittle to automate
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
          Recorded macros break the moment a layout shifts. General agents
          hallucinate and act without proof. Both ask you to trust a black box.
          Aemulus learns the{" "}
          <span className="text-ink">intent</span>{" "}
          of a task,
          shows its work on every step, and stops to ask when it isn&apos;t sure.
        </p>
      </section>

      {/* How it works */}
      <section className="border-t border-border py-14">
        <Label>How it works</Label>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            ["Record", "Do the task once in a controlled browser. Every action is captured with a screenshot."],
            ["Generalize", "Claude turns the demonstration into a reusable skill - the intent, and the fields that vary."],
            ["Run", "Point the skill at new inputs - one, or hundreds. It executes on its own and flags only what's new."],
          ].map(([t, b], i) => (
            <Card key={t} className="p-5">
              <Label>Step 0{i + 1}</Label>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{b}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Live today */}
      <section className="border-t border-border py-14">
        <Label>Live today</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Already real - not a promise
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Everything below works in the product right now, before the token even
          launches.
        </p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-base)] border border-border bg-border sm:grid-cols-2 md:grid-cols-3">
          {LIVE_TODAY.map(([t, b]) => (
            <div key={t} className="bg-surface p-5">
              <h3 className="text-sm font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Token */}
      <section className="border-t border-border py-14">
        <Label>The token</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">$AEMU</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
          Aemulus is free to browse and learn. $AEMU is the{" "}
          <span className="text-ink">usage layer</span>: holding it unlocks
          autonomous run capacity, and it&apos;s the unit creators earn when
          their skills are run. A fair launch on pump.fun - no presale, no
          insider allocation; liquidity is seeded by the bonding curve.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <Label>Utility · Usage</Label>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Browsing and recording are free. Holding $AEMU raises your daily
              autonomous-run quota by tier.
            </p>
          </Card>
          <Card className="p-5">
            <Label>Utility · Creator fees</Label>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Each external run of a published skill credits its creator{" "}
              {SOLANA.runFee} $AEMU - settled on-chain at launch.
            </p>
          </Card>
          <Card className="p-5">
            <Label>Utility · Proof</Label>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Run receipts are Merkle-batched and anchored on Solana, so trust is
              verifiable rather than claimed.
            </p>
          </Card>
        </div>
      </section>

      {/* Tiers */}
      <section className="border-t border-border py-14">
        <Label>Access tiers</Label>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <Card key={t.name} className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="font-semibold tracking-tight">{t.name}</span>
                <Badge>Tier {i + 1}</Badge>
              </div>
              <div className="mono text-xl font-semibold tracking-tight">
                {quotaLabel(t.quota)}
              </div>
              <div className="text-sm text-ink-2">
                Hold{" "}
                <span className="text-ink">≥ {t.min.toLocaleString()} $AEMU</span>
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <BuyAemu variant="primary" />
          <Link href="/roadmap" className="text-sm text-ink-2 hover:text-ink">
            See the roadmap →
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
