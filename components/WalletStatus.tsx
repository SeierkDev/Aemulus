"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "./ui";
import { useAuth } from "./auth-context";
import { short } from "@/lib/format";


/**
 * Wallet identity in the nav. The bare "Connect wallet" button is gone —
 * connecting is handled by the usage gate (e.g. Record a task). This only shows
 * once you're connected: the sign-in step, then your signed-in identity +
 * sign-out.
 */
export function WalletStatus() {
  const { connected, publicKey } = useWallet();
  const { session, loading, signingIn, error, signIn, signOut } = useAuth();

  if (loading) return null;

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-2.5 py-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          <span className="text-ink-2">{session.tier}</span>
          <span className="mono text-ink-3">{short(session.pubkey)}</span>
        </span>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    );
  }

  // Connected via the gate but not signed in yet → offer the sign-in step.
  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-ink-2">{error}</span>}
        <Button variant="primary" onClick={signIn} disabled={signingIn}>
          {signingIn ? "Check wallet…" : "Sign in"}
        </Button>
      </div>
    );
  }

  return null; // not connected — the usage gate handles it
}
