import { getSession } from "../auth";
import { gatingEnabled } from "../solana";
import { freeEntryLimit, usageThisPeriod, type Entitlement } from "./billing";

// AP identity = a Phantom wallet ($AEMU). Workspace scoping keys on the wallet
// (`w_<pubkey>`), so accounts never share data. Access + entry limits are
// governed by the wallet's $AEMU tier.

export interface ApViewer {
  workspaceId: string;
  name: string;
  pubkey: string;
  tier: string;
  level: number;
}

function shortKey(pk: string): string {
  return pk.length > 9 ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : pk;
}

/** Resolve the current AP viewer from the wallet session (level ≥ 1 = has access). */
export async function getApViewer(): Promise<ApViewer | null> {
  const wallet = await getSession().catch(() => null);
  if (wallet && wallet.level >= 1) {
    return {
      workspaceId: `w_${wallet.pubkey}`,
      name: shortKey(wallet.pubkey),
      pubkey: wallet.pubkey,
      tier: wallet.tier,
      level: wallet.level,
    };
  }
  return null;
}

/** The audit actor for a viewer. */
export function viewerActor(v: ApViewer): { userId: string; role: "clerk" } {
  return { userId: v.pubkey, role: "clerk" };
}

/** Entitlement by $AEMU tier: Pro/Whale (and Open when gating is off) unlimited;
 *  Holder is capped at the free limit. */
export async function viewerEntitlement(viewer: ApViewer, now: number): Promise<Entitlement> {
  const unlimited = viewer.level >= 2;
  const enforced = gatingEnabled();
  const used = await usageThisPeriod(viewer.workspaceId, now);
  const limit = unlimited ? null : freeEntryLimit();
  return {
    plan: unlimited ? "pro" : "free",
    used,
    limit,
    canEnter: !enforced || unlimited || used < freeEntryLimit(),
    enforced,
  };
}

/** Entitlement at the current time (impure boundary — reads the clock here). */
export async function liveViewerEntitlement(viewer: ApViewer): Promise<Entitlement> {
  return viewerEntitlement(viewer, Date.now());
}
