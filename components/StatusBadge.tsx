import { Badge } from "./ui";
import type { RunStatus } from "@/lib/types";

const LABEL: Record<RunStatus, string> = {
  running: "Running",
  awaiting_input: "Awaiting input",
  needs_review: "Needs review",
  completed: "Completed",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const dot =
    status === "completed"
      ? "bg-ink"
      : status === "needs_review"
        ? "bg-ink-2"
        : status === "running" || status === "awaiting_input"
          ? "animate-pulse bg-ink-2"
          : "bg-ink-3";
  return (
    <Badge>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {LABEL[status]}
    </Badge>
  );
}
