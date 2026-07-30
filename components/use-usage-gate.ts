"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "./auth-context";
import { maybePhantomDeepLink } from "./wallet-connect";

/**
 * Usage gate. Viewing the app is open; *using* it (record / generalize / run)
 * requires a signed-in wallet. Components call this to decide whether to show
 * the real action or a connect/sign-in prompt - gating happens at action time,
 * never at page load.
 */
export function useUsageGate() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { session, signIn, signingIn } = useAuth();

  const ready = !!session;
  const label = !connected
    ? "Connect wallet"
    : signingIn
      ? "Check wallet…"
      : "Sign in to use";

  function gate() {
    if (connected) return void signIn();
    // On mobile with no injected wallet, deep-link into Phantom instead of
    // opening an empty modal.
    if (maybePhantomDeepLink()) return;
    setVisible(true);
  }

  return { ready, gate, label, signingIn };
}
