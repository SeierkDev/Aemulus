"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "./ui";
import { useAuth } from "./auth-context";
import { short } from "@/lib/format";


/** Connect → Sign in → signed-in identity, shown in the nav. Monochrome. */
export function WalletStatus() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { session, loading, signingIn, error, signIn, signOut } = useAuth();

  if (loading) {
    return <div className="h-9 w-28 rounded-[var(--radius-base)] bg-surface-2" />;
  }

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

  if (!connected || !publicKey) {
    return (
      <Button variant="default" onClick={() => setVisible(true)}>
        Connect wallet
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-ink-2">{error}</span>}
      <Button variant="primary" onClick={signIn} disabled={signingIn}>
        {signingIn ? "Check wallet…" : "Sign in"}
      </Button>
    </div>
  );
}
