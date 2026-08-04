import { limitForLevel, watchLimitForLevel, computeTier, getAemulusBalance } from "./solana";
import { countRecentRuns } from "./runs";
import type { QuotaReserve } from "./runs";
import type { Session } from "./auth";

/**
 * Tier-based daily run quotas. The window is a rolling 24h; the limit comes
 * from the wallet's access level (Holder < Pro < Whale/Open). Each run - and
 * each resolve/retry - counts against it.
 */
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface QuotaStatus {
  tier: string;
  used: number;
  limit: number; // -1 when unlimited
  remaining: number | null; // null when unlimited
  unlimited: boolean;
  ok: boolean; // is there at least one run left?
}

export async function getQuota(
  session: Session,
  kind: "runs" | "watch" = "runs",
): Promise<QuotaStatus> {
  const limit =
    kind === "watch" ? watchLimitForLevel(session.level) : limitForLevel(session.level);
  const unlimited = limit < 0;
  const used = await countRecentRuns(
    session.pubkey,
    Date.now() - QUOTA_WINDOW_MS,
    kind,
  );
  return {
    tier: session.tier,
    used,
    limit,
    remaining: unlimited ? null : Math.max(0, limit - used),
    unlimited,
    ok: unlimited || used < limit,
  };
}

/**
 * The atomic reservation to hand startRun so the per-day quota can't be
 * exceeded by a concurrent burst that races past the soft getQuota() check.
 * Unlimited tiers (limit < 0) make the reserve a no-op. Same window/limit as
 * getQuota, so the soft check and the hard reserve agree.
 */
export function quotaReserve(session: Session): QuotaReserve {
  return { limit: limitForLevel(session.level), windowMs: QUOTA_WINDOW_MS };
}

/**
 * An atomic quota reserve for an OWNER pubkey rather than a request session —
 * derives the tier limit from the wallet's live $AEMU balance. Used by detached run
 * paths (skill chaining) that start a run without a session but must still meter it,
 * so a parent skill's `run_skill` steps can't spawn unlimited unmetered child runs.
 * Unlimited tiers (limit < 0) make the reserve a no-op in createRun.
 */
export async function quotaReserveForOwner(owner: string): Promise<QuotaReserve> {
  const level = computeTier(await getAemulusBalance(owner)).level;
  return { limit: limitForLevel(level), windowMs: QUOTA_WINDOW_MS };
}

/** The same reservation for a watch check, against the watch allowance. */
export function quotaReserveForWatch(level: number): QuotaReserve {
  return { limit: watchLimitForLevel(level), windowMs: QUOTA_WINDOW_MS };
}
