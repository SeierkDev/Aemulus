/** Display helpers shared across pages. */

/** Format a timestamp for display; "—" when null. */
export function when(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

/** Abbreviate a wallet pubkey like "ABcd…WXyz"; "anon" when empty. */
export function short(pk: string): string {
  return pk ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : "anon";
}
