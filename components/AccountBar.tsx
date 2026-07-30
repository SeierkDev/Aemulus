"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "./ui";
import { useAuth } from "./auth-context";
import { maybePhantomDeepLink } from "./wallet-connect";
import { short } from "@/lib/format";

/**
 * Self-contained account control for wallet-scoped pages (earnings, skills,
 * runs). Connecting and signing in happen as one flow - picking a wallet in the
 * modal auto-triggers the SIWS sign-in - and once signed in it shows the wallet
 * identity + Sign out right here on the page. The nav stays clean; there is no
 * global wallet button.
 */
export function AccountBar() {
  const { connected, publicKey, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const { session, loading, signingIn, signIn, signOut } = useAuth();
  const attempted = useRef(false);

  // Once the wallet connects (and can actually sign), kick off sign-in
  // automatically so the user isn't left with a second "Sign in" click. Attempt
  // once per connection; reset when they disconnect so a reconnect can retry.
  useEffect(() => {
    const ready = connected && publicKey && typeof signMessage === "function";
    if (ready && !session && !signingIn && !attempted.current) {
      attempted.current = true;
      void signIn();
    }
    if (!connected) attempted.current = false;
  }, [connected, publicKey, signMessage, session, signingIn, signIn]);

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

  return (
    <Button
      variant="primary"
      onClick={() => {
        if (connected) return void signIn();
        // On mobile with no injected wallet, deep-link into Phantom instead of
        // opening an empty modal.
        if (maybePhantomDeepLink()) return;
        setVisible(true);
      }}
      disabled={signingIn}
    >
      {signingIn ? "Check wallet…" : connected ? "Sign in" : "Connect wallet"}
    </Button>
  );
}
