import { Card, Label } from "@/components/ui";

/** A faux browser window used to frame the product mockups. */
function Frame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <span className="h-2 w-2 rounded-full border border-border-strong" />
        <span className="h-2 w-2 rounded-full border border-border-strong" />
        <span className="h-2 w-2 rounded-full border border-border-strong" />
        <span className="mono ml-2 truncate text-[0.65rem] text-ink-3">{url}</span>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-ink-3">
      {children}
    </span>
  );
}

function TraceRow({ i, action, label }: { i: string; action: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-xs">
      <span className="mono w-5 shrink-0 text-ink-3">{i}</span>
      <Chip>{action}</Chip>
      <span className="truncate text-ink-2">{label}</span>
    </div>
  );
}

/** "See it in action" - framed mockups of the three core moments. */
export function Showcase() {
  return (
    <section className="border-t border-border py-20">
      <div className="text-center">
        <Label>See it in action</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Record once. Run with proof. Verify on-chain.
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
          Every run captures a screenshot per step and a tamper-evident receipt -
          batched into a Merkle root anyone can verify.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {/* Record */}
        <Frame url="example.com/invoices/new">
          <Label>Recording</Label>
          <div className="mt-2 divide-y divide-border">
            <TraceRow i="00" action="navigate" label="invoices/new" />
            <TraceRow i="01" action="input" label="Vendor → Acme Corp" />
            <TraceRow i="02" action="input" label="Amount → 1,499.00" />
            <TraceRow i="03" action="click" label="Save & close" />
          </div>
        </Frame>

        {/* Run with proof */}
        <Frame url="aemulus · run">
          <Label>Run · proof</Label>
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-ink" />
              <span className="text-ink-2">Step 02 · completed</span>
            </div>
            <div className="grid h-20 place-items-center rounded border border-border bg-surface-2 text-[0.6rem] text-ink-3">
              proof screenshot
            </div>
            <div className="mono truncate text-[0.65rem] text-ink-3">
              sha256:04e1c9…a7f7
            </div>
          </div>
        </Frame>

        {/* Verify */}
        <Frame url="aemulus/verify/run_8c…">
          <div className="flex items-center justify-between">
            <Label>Verify</Label>
            <Chip>✓ intact</Chip>
          </div>
          <div className="mt-3 space-y-2 text-xs text-ink-2">
            <p className="text-ink">Receipt verified</p>
            <p>
              Merkle batch <span className="text-ink">✓ in batch</span> - leaf
              #42 / 128
            </p>
            <div className="mono truncate text-[0.65rem] text-ink-3">
              root:9f2b…c310
            </div>
          </div>
        </Frame>
      </div>
    </section>
  );
}
