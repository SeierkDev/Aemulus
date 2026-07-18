import { gatingEnabled } from "./solana";
import { registryEnabled } from "./registry";
import { zkReceiptsEnabled } from "./zk-receipts";
import { payoutsEnabled } from "./payout";

/**
 * The live launch configuration — which gated systems are actually ON, derived
 * from the environment. Logged once at boot and exposed via the ops-gated health
 * endpoint, so after a launch deploy an operator can confirm at a glance that
 * gating/anchoring/payouts took effect (rather than discovering a silent
 * misconfig — e.g. the token launched but AEMULUS_MINT was never set).
 */
export interface LaunchStatus {
  /** $AEMU tier gating (AEMULUS_MINT set). Off = every wallet gets Open/unlimited. */
  gating: boolean;
  /** Fail-closed guard: refuse to boot with gating off (AEMULUS_REQUIRE_GATING=1). */
  requireGating: boolean;
  /** Merkle-batch Memo anchoring (a treasury/receipt signer is configured). */
  memoAnchor: boolean;
  /** aemulus-registry program anchoring. */
  registryAnchor: boolean;
  /** ZK-compressed receipt anchoring. */
  zkAnchor: boolean;
  /** On-chain creator payouts. */
  payouts: boolean;
  /** The anchor reconciler runs (true iff any anchor path is live). */
  reconciler: boolean;
}

export function launchStatus(): LaunchStatus {
  const memoAnchor = !!process.env.AEMULUS_RECEIPT_SECRET;
  const registryAnchor = registryEnabled();
  const zkAnchor = zkReceiptsEnabled();
  return {
    gating: gatingEnabled(),
    requireGating: process.env.AEMULUS_REQUIRE_GATING === "1",
    memoAnchor,
    registryAnchor,
    zkAnchor,
    payouts: payoutsEnabled(),
    reconciler: memoAnchor || registryAnchor || zkAnchor,
  };
}

/** One-line human summary for the boot log. */
export function launchStatusLine(): string {
  const s = launchStatus();
  const on = (b: boolean) => (b ? "on" : "off");
  const gate = s.gating
    ? "on"
    : s.requireGating
      ? "OFF-BUT-REQUIRED(!)" // shouldn't happen — validateAtBoot fails closed first
      : "off (pre-launch)";
  return (
    `gating=${gate} · anchor[memo=${on(s.memoAnchor)} registry=${on(s.registryAnchor)} zk=${on(s.zkAnchor)}]` +
    ` · payouts=${on(s.payouts)} · reconciler=${on(s.reconciler)}`
  );
}
