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
  // A non-positive balance is ALWAYS Locked while gating is on — even if a threshold
  // was misconfigured to 0 or negative. minNum clamps a negative min to 0, and a
  // `balance >= 0` comparison would then admit a zero-balance / no-token wallet to
  // Holder (or, with proMin/whaleMin=0, to Whale), silently collapsing the whole gate.
  // Access requires an ACTUAL positive holding.
  if (!(balance > 0)) return { name: "Locked", level: 0, allowed: false };
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
 * Read a wallet's total $AEMU balance (UI amount, summed across token accounts),
 * returning NULL when the read could not be completed (RPC error/timeout) — as
 * distinct from a confirmed 0 balance. Use this (not getAemulusBalance) where a
 * transient failure must NOT trigger a destructive action: the scheduler must skip
 * a tick and retry rather than permanently deactivate a legit schedule on one blip.
 * Returns 0 (not null) when gating is off. Bounds the RPC read (web3.js has no
 * request timeout) at 8s.
 */
export async function readAemulusBalance(owner: string): Promise<number | null> {
  if (!gatingEnabled()) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((res) => {
    timer = setTimeout(() => res(null), 8_000);
  });
  try {
    const read = (async () => {
      const res = await connection().getParsedTokenAccountsByOwner(
        new PublicKey(owner),
        { mint: new PublicKey(SOLANA.mint) },
      );
      let total = 0;
      for (const { account } of res.value) {
        // Use uiAmountString, not the uiAmount float: the RPC spec allows
        // uiAmount to be null (unrepresentable) and it loses precision past 2^53
        // base units, either of which would silently undercount and misclassify
        // the wallet to a lower tier. The string is always present + exact.
        const s = account.data.parsed?.info?.tokenAmount?.uiAmountString;
        const amt = typeof s === "string" ? Number(s) : NaN;
        if (Number.isFinite(amt)) total += amt;
      }
      return total;
    })();
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fail-closed balance read: returns 0 when gating is off, on any RPC error/timeout,
 * or no holdings. Use for gating checks that should deny on an unresolved read
 * (sign-in, quota). Callers that must not take a destructive/irreversible action on
 * a transient failure should use readAemulusBalance and handle null explicitly.
 */
export async function getAemulusBalance(owner: string): Promise<number> {
  return (await readAemulusBalance(owner)) ?? 0;
}
