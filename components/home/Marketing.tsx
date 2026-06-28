import Link from "next/link";
import { Badge, Button, Card, Label } from "@/components/ui";
import { BuyAemu } from "@/components/BuyAemu";
import { SOLANA, gatingEnabled, limitForLevel } from "@/lib/solana";

const STAGES = [
  ["Record", "Do the task once in a controlled browser — Aemulus captures every action with a screenshot."],
  ["Generalize", "Claude turns that one demonstration into a reusable skill: the intent, and the fields that vary."],
  ["Run", "Point the skill at new inputs and it executes on its own — flagging only what it isn't sure about."],
];

const DIFFERENTIATORS = [
  ["Knows when to stop", "Every step carries a confidence score. The cases it isn't sure about get flagged for you — never guessed."],
  ["Brings receipts", "Each step is captured with a screenshot. You see exactly what happened, in order. Trust by proof, not faith."],
  ["Survives UI changes", "It understands the intent of each step, so when a layout shifts it adapts — where recorded macros simply break."],
];

const EXAMPLES = [
  ["Data entry", "Copy fields from invoices, emails, or PDFs into a web form or CRM — the next hundred, automatically."],
  ["Bulk updates", "Change a status, tag, or price across many records in an internal tool."],
  ["Lead gathering", "Visit a list of pages and pull the same details from each into a table."],
  ["Cross-posting", "Publish the same content across several sites or dashboards."],
  ["Form filling", "Submit the same multi-step form for a batch of inputs."],
  ["Reconciliation", "Pull a number from one place and enter it in another, row after row."],
];

const FAQ = [
  ["Do I need to code?", "No. If you can do the task in a browser, you can teach it — you record yourself doing it once."],
  ["What can it run?", "Anything you can do in a web browser today. Recording any app on your screen is on the roadmap."],
  ["Will it do something I didn't intend?", "It pauses and asks whenever it isn't confident, and every step is screenshotted — so you stay in control."],
  ["What happens when a site changes?", "Aemulus reasons about the page to find the right element, and flags the step for a quick fix if it can't."],
  ["What is $AEMU for?", "Browsing is free. Holding $AEMU unlocks usage — the more you hold, the more autonomous runs you get each day."],
];

const TIERS = [
  { name: "Holder", level: 1, min: SOLANA.holderMin },
  { name: "Pro", level: 2, min: SOLANA.proMin },
  { name: "Whale", level: 3, min: SOLANA.whaleMin },
];

function quotaLabel(level: number): string {
  const n = limitForLevel(level);
  return n < 0 ? "Unlimited runs" : `${n} runs / day`;
}

/** All the static marketing sections + footer (server, no props). */
export function Marketing() {
  return (
    <>
      {/* How it works */}
      <section className="grid gap-4 py-16 md:grid-cols-3">
        {STAGES.map(([title, body], i) => (
          <Card key={title} className="p-5">
            <Label>Stage 0{i + 1}</Label>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
          </Card>
        ))}
      </section>

      {/* Why it's different */}
      <section className="border-t border-border py-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Built to be trusted unsupervised
        </h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-base)] border border-border bg-border md:grid-cols-3">
          {DIFFERENTIATORS.map(([t, b]) => (
            <div key={t} className="bg-surface p-5">
              <h3 className="text-sm font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you can automate */}
      <section className="border-t border-border py-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          What you can automate
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
          Anything repetitive you do in a browser. A few common ones:
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {EXAMPLES.map(([t, b]) => (
            <Card key={t} className="p-5">
              <h3 className="text-sm font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{b}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Tiers — token utility */}
      <section className="border-t border-border py-16">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Access tiers
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
              Browsing Aemulus is free. Running skills is powered by $AEMU — the
              more you hold, the more autonomous runs you get each day.
            </p>
          </div>
          <BuyAemu variant="primary" />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <Card key={t.name} className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="font-semibold tracking-tight">{t.name}</span>
                <Badge>Tier {t.level}</Badge>
              </div>
              <div className="mono text-2xl font-semibold tracking-tight">
                {quotaLabel(t.level)}
              </div>
              <div className="text-sm text-ink-2">
                Hold{" "}
                <span className="text-ink">≥ {t.min.toLocaleString()} $AEMU</span>
              </div>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-3">
          {gatingEnabled()
            ? "Gating is live — hold $AEMU to run."
            : "Token not launched yet — sign in with any wallet to use Aemulus free during pre-launch."}
        </p>
      </section>

      {/* FAQ */}
      <section className="border-t border-border py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {FAQ.map(([q, a]) => (
            <Card key={q} className="p-5">
              <h3 className="text-sm font-semibold">{q}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{a}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="mb-16 overflow-hidden rounded-[var(--radius-base)] border border-border-strong bg-surface-2 p-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Show it once. Let it run.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
          Record your first task and watch Aemulus take it from there.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Link href="/record">
            <Button variant="primary">Record a task</Button>
          </Link>
          <BuyAemu variant="default" />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mono text-sm font-semibold">aemulus</div>
            <div className="mt-1 text-xs text-ink-3">show once · run forever</div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
            <a href={SOLANA.pumpUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              pump.fun
            </a>
            <a href={SOLANA.xUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              X
            </a>
            <a href={SOLANA.githubUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              GitHub
            </a>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <span className="mono text-xs text-ink-3">
            $AEMU CA: {SOLANA.mint || "TBA — launching on pump.fun"}
          </span>
        </div>
      </footer>
    </>
  );
}
