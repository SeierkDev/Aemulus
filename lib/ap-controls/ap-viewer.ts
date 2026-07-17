import { getApSession } from "./ap-session";
import { getSession } from "../auth";
import { gatingEnabled } from "../solana";
import { entitlement as billingEntitlement, freeEntryLimit, usageThisPeriod, type Entitlement } from "./billing";

// A unified AP identity: either an email/password account or a Phantom wallet
// ($AEMU). Both feed the same AP surface. Workspace scoping keys on the identity
// (user id for email, `w_<pubkey>` for wallet), so the two never share data.

export interface ApViewer {
  kind: "email" | "wallet";
  workspaceId: string;
  name: string;
  email?: string;
  pubkey?: string;
  tier?: string;
  level?: number;
}

function shortKey(pk: string): string {
  return pk.length > 9 ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : pk;
}

/** Resolve the current AP viewer from the email session, else the wallet session. */
export async function getApViewer(): Promise<ApViewer | null> {
  const email = await getApSession();
  if (email) return { kind: "email", workspaceId: email.userId, name: email.name, email: email.email };
  const wallet = await getSession().catch(() => null);
  if (wallet && wallet.level >= 1) {
    return {
      kind: "wallet",
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
  return { userId: v.kind === "wallet" ? (v.pubkey as string) : v.workspaceId, role: "clerk" };
}

/** Entitlement for a viewer: email → Stripe plan; wallet → $AEMU tier. */
export async function viewerEntitlement(viewer: ApViewer, now: number): Promise<Entitlement> {
  if (viewer.kind === "email") return billingEntitlement(viewer.workspaceId, now);
  // Wallet: Pro/Whale (and Open when gating is off) are unlimited; Holder is capped.
  const unlimited = (viewer.level ?? 0) >= 2;
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
