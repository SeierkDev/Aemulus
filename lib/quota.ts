import { limitForLevel } from "./solana";
import { countRecentRuns } from "./runs";
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

export async function getQuota(session: Session): Promise<QuotaStatus> {
  const limit = limitForLevel(session.level);
  const unlimited = limit < 0;
  const used = await countRecentRuns(
    session.pubkey,
    Date.now() - QUOTA_WINDOW_MS,
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
