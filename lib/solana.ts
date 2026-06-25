import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Solana / $MIMIC token-gating config and helpers (server-side).
 *
 * Key behavior: if MIMIC_MINT is unset, gating is OFF — every signed-in wallet
 * is treated as "Open" with full access. Set MIMIC_MINT to the pump.fun token
 * address after launch and gating activates automatically, no code change.
 */

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const SOLANA = {
  /** The $MIMIC SPL mint. Empty until the pump.fun launch. */
  mint: process.env.MIMIC_MINT ?? "",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  /** Minimum balance for access, and the higher tier cutoffs (tunable). */
  holderMin: num("MIMIC_MIN_BALANCE", 1),
  proMin: num("MIMIC_PRO_BALANCE", 1_000_000),
  whaleMin: num("MIMIC_WHALE_BALANCE", 10_000_000),
  /** Public pump.fun link shown on the gated screen (set after launch). */
  pumpUrl: process.env.MIMIC_PUMP_URL ?? "https://pump.fun",
};

export function gatingEnabled(): boolean {
  return SOLANA.mint.length > 0;
}

export type Tier = {
  name: "Open" | "Whale" | "Pro" | "Holder" | "Locked";
  level: 0 | 1 | 2 | 3;
  allowed: boolean;
};

/** Map a token balance to an access tier. */
export function computeTier(balance: number): Tier {
  if (!gatingEnabled()) return { name: "Open", level: 3, allowed: true };
  if (balance >= SOLANA.whaleMin) return { name: "Whale", level: 3, allowed: true };
  if (balance >= SOLANA.proMin) return { name: "Pro", level: 2, allowed: true };
  if (balance >= SOLANA.holderMin) return { name: "Holder", level: 1, allowed: true };
  return { name: "Locked", level: 0, allowed: false };
}

let conn: Connection | null = null;
function connection(): Connection {
  return (conn ??= new Connection(SOLANA.rpcUrl, "confirmed"));
}

/**
 * Read a wallet's total $MIMIC balance (UI amount, summed across token
 * accounts). Returns 0 when gating is off, on any RPC error, or no holdings.
 */
export async function getMimicBalance(owner: string): Promise<number> {
  if (!gatingEnabled()) return 0;
  try {
    const res = await connection().getParsedTokenAccountsByOwner(
      new PublicKey(owner),
      { mint: new PublicKey(SOLANA.mint) },
    );
    let total = 0;
    for (const { account } of res.value) {
      const amt = account.data.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof amt === "number") total += amt;
    }
    return total;
  } catch {
    return 0;
  }
}
