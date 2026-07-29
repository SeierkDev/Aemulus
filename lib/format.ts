/** Display helpers shared across pages. */

/** Format a timestamp for display; "-" when null. */
export function when(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : "-";
}

/** Compact relative time, e.g. "just now", "15m ago", "3h ago", "2d ago". */
export function timeAgo(ts: number | null): string {
  if (!ts) return "-";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}

/** Abbreviate a wallet pubkey like "ABcd…WXyz"; "anon" when empty. */
export function short(pk: string): string {
  return pk ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : "anon";
}

/** Coarse relative time like "3d ago" / "just now". */
export function ago(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
