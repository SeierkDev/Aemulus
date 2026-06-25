import Link from "next/link";
import { Badge, Button, Card, Label } from "@/components/ui";

const STAGES = [
  {
    n: "01",
    title: "Record",
    body: "Do the task once in a controlled browser. Mimic captures every action and what the screen looked like — not just clicks, but context.",
  },
  {
    n: "02",
    title: "Generalize",
    body: "Claude turns that single demonstration into a reusable skill: the intent behind each step, the fields that vary, the parts that don't.",
  },
  {
    n: "03",
    title: "Run",
    body: "Point the skill at new inputs and it executes on its own — handling variation, capturing proof, and flagging only the cases it isn't sure about.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      {/* Top bar */}
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-md border border-border-strong bg-surface-2">
            {/* monochrome mark: two nested squares = the copy */}
            <div className="relative h-3.5 w-3.5">
              <span className="absolute inset-0 rounded-[3px] border border-ink-2" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-[3px] border border-ink bg-bg" />
            </div>
          </div>
          <span className="mono text-sm font-semibold tracking-tight">
            mimic
          </span>
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/skills">
            <Button variant="ghost">Skills</Button>
          </Link>
          <Link href="/runs">
            <Button variant="ghost">Runs</Button>
          </Link>
          <Link href="/record">
            <Button variant="primary">Record a task</Button>
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-start gap-6 border-t border-border pt-16">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Show it once. It does the rest.
        </Badge>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight">
          Automate any browser task by{" "}
          <span className="text-ink-2">demonstrating</span> it — not coding it.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
          Mimic watches you do a repetitive task one time, learns the intent
          behind it, and then runs it autonomously across hundreds of cases —
          stopping to ask only when it hits something genuinely new.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Link href="/record">
            <Button variant="primary">Record your first task</Button>
          </Link>
          <span className="text-sm text-ink-3">
            No code. No selectors. Just do it once.
          </span>
        </div>
      </section>

      {/* How it works */}
      <section className="grid gap-4 py-20 md:grid-cols-3">
        {STAGES.map((s) => (
          <Card key={s.n} className="p-5">
            <Label>Stage {s.n}</Label>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              {s.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.body}</p>
          </Card>
        ))}
      </section>

      {/* The differentiator strip */}
      <section className="mb-20 grid gap-px overflow-hidden rounded-[var(--radius-base)] border border-border bg-border md:grid-cols-3">
        {[
          [
            "Knows when to stop",
            "Per-step confidence. The weird ones get flagged for you, not guessed.",
          ],
          [
            "Brings receipts",
            "Every step is captured with a screenshot. Trust by proof, not faith.",
          ],
          [
            "No brittleness",
            "It understands the task, so it survives layout changes that break scripts.",
          ],
        ].map(([t, b]) => (
          <div key={t} className="bg-surface p-5">
            <h4 className="text-sm font-semibold">{t}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{b}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto flex items-center justify-between border-t border-border py-6 text-sm text-ink-3">
        <span className="mono">mimic</span>
        <span>show once · run forever</span>
      </footer>
    </div>
  );
}
