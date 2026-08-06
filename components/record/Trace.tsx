import { Card, Label } from "@/components/ui";
import type { RecordedAction } from "@/lib/types";

function actionLabel(a: RecordedAction): string {
  switch (a.type) {
    case "navigate":
      return `Open ${a.value ?? ""}`;
    case "click":
      return `Click ${a.name || a.text || a.tag || "element"}`;
    case "input":
      return `Type "${a.value ?? ""}" into ${a.name || a.tag}`;
    case "select":
      return `Select "${a.value ?? ""}" in ${a.name || a.tag}`;
    case "key":
      return `Press ${a.key}`;
    case "submit":
      return `Submit ${a.name || "form"}`;
    // Without this a capture rendered as the bare word "extract" with nothing
    // after it — and the live trace is the only place you can confirm it read
    // the right thing before you stop recording.
    case "extract":
      // Refused: a capture on a credential field is dropped rather than turned
      // into a step, because the step would read that field live on every run.
      if (a.sensitive) return "Capture refused - that looks like a credential field";
      return a.value
        ? `Capture ${a.outputKey || a.name || "value"} = "${a.value}"`
        : `Capture ${a.outputKey || a.name || "value"}`;
    default:
      return a.type;
  }
}

/** Live, newest-first list of recorded actions. */
export function Trace({ actions }: { actions: RecordedAction[] }) {
  return (
    <Card className="flex min-h-[160px] flex-col">
      <div className="border-b border-border px-4 py-3">
        <Label>Trace</Label>
      </div>
      <ol className="flex-1 divide-y divide-border overflow-auto">
        {actions.length === 0 && (
          <li className="px-4 py-6 text-sm text-ink-3">
            Steps appear here as you interact with the view.
          </li>
        )}
        {[...actions].reverse().map((a) => (
          <li
            key={a.idx}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <span className="mono w-8 shrink-0 text-ink-3">
              {String(a.idx).padStart(2, "0")}
            </span>
            <span className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-3">
              {a.type}
            </span>
            <span className="truncate text-ink-2">{actionLabel(a)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
