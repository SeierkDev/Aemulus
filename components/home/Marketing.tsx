import Link from "next/link";
import { Button, Card, Label } from "@/components/ui";
import { BuyAemu } from "@/components/BuyAemu";
import { SiteFooter } from "@/components/SiteFooter";
import { Reveal } from "@/components/Reveal";

const STAGES = [
  ["Record", "Do the task once in a controlled browser - Aemulus captures every action with a screenshot."],
  ["Generalize", "Claude turns that one demonstration into a reusable skill: the intent, and the fields that vary."],
  ["Run", "Point the skill at new inputs - one or hundreds - and it executes on its own, flagging only what it isn't sure about."],
];

/** Clean landing flow: how it works + a single CTA, then the footer. */
export function Marketing() {
  return (
    <>
      {/* How it works */}
      <Reveal>
      <section className="border-t border-border py-20 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
          Three steps from a single demonstration to autonomous runs.
        </p>
        <div className="mt-8 grid gap-4 text-left md:grid-cols-3">
          {STAGES.map(([title, body], i) => (
            <Card key={title} className="p-5">
              <Label>Step 0{i + 1}</Label>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
            </Card>
          ))}
        </div>
      </section>
      </Reveal>

      {/* Verifiable receipts - the differentiator */}
      <Reveal>
      <section className="border-t border-border py-20">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Every run leaves a proof
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
            Not a log you have to trust - a tamper-evident receipt anyone can
            check, on their own.
          </p>
        </div>
        <div className="mt-8 grid gap-4 text-left md:grid-cols-3">
          <Card className="p-5">
            <Label>Tamper-evident</Label>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              Hashed receipt
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              The run and every proof screenshot hash to one receipt. Change a
              pixel and verification fails.
            </p>
          </Card>
          <Card className="p-5">
            <Label>On-chain</Label>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              Anchored on Solana
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Receipts are Merkle-batched and the root is anchored on-chain -
              independently confirmable, scalable to millions of runs.
            </p>
          </Card>
          <Card className="p-5">
            <Label>Private</Label>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              Prove one field
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Selective disclosure: prove a single output or input against the
              anchored commitment without revealing anything else.
            </p>
          </Card>
        </div>
        <div className="mt-6 text-center">
          <Link href="/verify-disclosure">
            <Button variant="default">Try the verifier →</Button>
          </Link>
        </div>
      </section>
      </Reveal>

      {/* CTA */}
      <Reveal>
      <section className="mb-20 overflow-hidden rounded-[var(--radius-base)] border border-border-strong bg-surface-2 p-10 text-center">
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
      </Reveal>

      <SiteFooter />
    </>
  );
}
