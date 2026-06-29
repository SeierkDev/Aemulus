"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { AuthProvider } from "./auth-context";

const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
// Stable reference - a fresh [] each render would invalidate the wallet
// adapter's internal useMemo (Phantom is detected via the Wallet Standard).
const WALLETS: Adapter[] = [];

/**
 * App-wide client providers: Solana connection + wallet adapter (Phantom is
 * auto-detected via the Wallet Standard), the wallet modal, and Aemulus's auth
 * context. Wraps the whole app from the root layout.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => RPC, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={WALLETS} autoConnect>
        <WalletModalProvider>
          <AuthProvider>{children}</AuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
