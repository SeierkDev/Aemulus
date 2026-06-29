import { Label } from "./ui";

/** Tiny monochrome bar chart - no deps, server-renderable. */
export function MiniChart({
  caption,
  values,
}: {
  caption: string;
  values: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <div>
      <Label>{caption}</Label>
      <div className="mt-3 flex h-24 items-end gap-1">
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-ink/70 transition-colors hover:bg-ink"
            style={{ height: `${Math.max(2, (v.value / max) * 100)}%` }}
            title={`${v.label}: ${v.value}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.6rem] text-ink-3">
        <span>{values[0]?.label}</span>
        <span>{values[values.length - 1]?.label}</span>
      </div>
    </div>
  );
}
