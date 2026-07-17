"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/components/auth-context";

// Phantom / $AEMU sign-in for the AP product. Reuses the app's existing wallet
// auth (connect → sign the SIWS message → session cookie); once signed in, the
// AP surface picks up the wallet session via getApViewer.
export function ApWalletSignIn() {
  const router = useRouter();
  const { connected } = useWallet();
  const { session, signingIn, error, signIn } = useAuth();

  useEffect(() => {
    if (session) {
      router.replace("/ap/queue");
      router.refresh();
    }
  }, [session, router]);

  return (
    <div className="space-y-2">
      {!connected ? (
        <WalletMultiButton />
      ) : (
        <button
          type="button"
          onClick={signIn}
          disabled={signingIn}
          className="w-full rounded-md border border-border-strong bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-30"
        >
          {signingIn ? "Check your wallet…" : "Sign in with your $AEMU wallet"}
        </button>
      )}
      {error && <p className="text-sm text-ink">{error}</p>}
    </div>
  );
}
