import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Solana / $AEMU token-gating config and helpers (server-side).
 *
 * Key behavior: if AEMULUS_MINT is unset, gating is OFF - every signed-in wallet
 * is treated as "Open" with full access. Set AEMULUS_MINT to the pump.fun token
 * address after launch and gating activates automatically, no code change.
 */

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** A balance threshold - clamped non-negative so a misconfigured negative
 *  value can't grant access to a zero-balance wallet while gating is on. */
function minNum(name: string, fallback: number): number {
  return Math.max(0, num(name, fallback));
}

/** The run fee accrues to a ledger summed across runs - must be a
 *  non-negative integer to stay exact through claim → base-unit payout. */
function intNum(name: string, fallback: number): number {
  const n = num(name, fallback);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const SOLANA = {
  /** The $AEMU SPL mint. Empty until the pump.fun launch. */
  mint: process.env.AEMULUS_MINT ?? "",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  /** Minimum balance for access, and the higher tier cutoffs (tunable). */
  holderMin: minNum("AEMULUS_MIN_BALANCE", 1),
  proMin: minNum("AEMULUS_PRO_BALANCE", 1_000_000),
  whaleMin: minNum("AEMULUS_WHALE_BALANCE", 10_000_000),
  /** Public pump.fun link for the "Get $AEMU" buy CTAs (set after launch). */
  pumpUrl: process.env.AEMULUS_PUMP_URL ?? "https://pump.fun",
  /** Social links (empty until set, so the UI hides them rather than pointing at
   *  the bare platform homepages). */
  xUrl: process.env.AEMULUS_X_URL ?? "",
  githubUrl: process.env.AEMULUS_GITHUB_URL ?? "",
  /** Daily run quotas per tier. A negative value means unlimited. */
  quotaHolder: num("AEMULUS_QUOTA_HOLDER", 5),
  quotaPro: num("AEMULUS_QUOTA_PRO", 50),
  quotaWhale: num("AEMULUS_QUOTA_WHALE", -1),
  /** $AEMU credited to a creator each time someone else runs their skill. */
  runFee: intNum("AEMULUS_RUN_FEE", 10),
};

/** Daily run limit for an access level (Whale/Open = level 3). <0 = unlimited. */
export function limitForLevel(level: number): number {
  if (level >= 3) return SOLANA.quotaWhale;
  if (level === 2) return SOLANA.quotaPro;
  if (level === 1) return SOLANA.quotaHolder;
  return 0; // locked - no runs (locked wallets never reach a run anyway)
}

export function gatingEnabled(): boolean {
  return SOLANA.mint.length > 0;
}

/** Whether $AEMU has launched (mint configured). Drives "coming soon" UI. */
export function tokenLaunched(): boolean {
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
 * Read a wallet's total $AEMU balance (UI amount, summed across token
 * accounts). Returns 0 when gating is off, on any RPC error, or no holdings.
 */
export async function getAemulusBalance(owner: string): Promise<number> {
  if (!gatingEnabled()) return 0;
  // Bound the RPC read: web3.js has no request timeout, so a connected-but-
  // unresponsive RPC would otherwise hang this call forever - and it's on the
  // gating-critical path (sign-in, scheduler, MCP). Time out → 0 (fails closed).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((res) => {
    timer = setTimeout(() => res(0), 8_000);
  });
  try {
    const read = (async () => {
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
    })();
    return await Promise.race([read, timeout]);
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
