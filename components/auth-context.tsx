"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import type { Session } from "@/lib/auth";

interface AuthValue {
  session: Session | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, disconnect } = useWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load any existing session on mount (guard against post-unmount setState).
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => alive && setSession(d.session ?? null))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (signingIn) return; // guard against double-submit (e.g. via the usage gate)
    setError(null);
    if (!publicKey || !signMessage) {
      setError("Connect a wallet first.");
      return;
    }
    setSigningIn(true);
    try {
      const { message } = await (await fetch("/api/auth/nonce")).json();
      const signature = await signMessage(new TextEncoder().encode(message));
      // Re-read the active key AFTER signing - the user may have switched
      // accounts mid-flow; sign + submit must agree on the same pubkey.
      const active = publicKey.toBase58();
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: active,
          signature: bs58.encode(signature),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Sign-in failed");
      setSession(data.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage, signingIn]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession(null);
    // Bound the wallet disconnect: the server cookie + client session are already
    // cleared, so a wallet adapter whose disconnect() never resolves must not hang
    // signOut() (which callers await before navigating away from a signed-out page).
    await Promise.race([
      disconnect().catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }, [disconnect]);

  return (
    <AuthContext.Provider
      value={{ session, loading, signingIn, error, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
