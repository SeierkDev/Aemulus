/** Monochrome star rating display (rounded). Server-safe. */
export function Stars({ value }: { value: number }) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="tracking-tight" aria-label={`${value.toFixed(1)} of 5`}>
      <span className="text-ink">{"★".repeat(full)}</span>
      <span className="text-ink-3">{"★".repeat(5 - full)}</span>
    </span>
  );
}
