"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SYNCHRONOUS in-flight latch. The `signingIn` state can't guard this: state
  // updates are async, so two callers in the same tick (the auto-sign-in effect
  // of two AccountBars on a page, or a click racing that effect) would both pass
  // a state check, both GET /api/auth/nonce, and the second nonce would overwrite
  // the first one's cookie - the signature the user actually produced then fails
  // to verify. A ref flips before any await, so only one sign-in can be in flight.
  const inFlight = useRef(false);

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
    if (inFlight.current) return; // a sign-in is already running
    // Some wallet adapters expose the account before signMessage is wired up
    // (or don't support it at all). Bail quietly instead of throwing a raw
    // "signMessage is not a function" - the button stays available to retry.
    if (!publicKey || typeof signMessage !== "function") return;
    inFlight.current = true;
    setError(null);
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
      // Re-render server components (e.g. /earnings, /skills, /runs) so they
      // pick up the freshly-set session cookie and show the wallet's data.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      inFlight.current = false;
      setSigningIn(false);
    }
    // `signingIn` is deliberately NOT a dependency: the ref above does the
    // guarding, and keeping it out gives signIn a stable identity so the
    // auto-sign-in effect that depends on it doesn't re-fire mid-flow.
  }, [publicKey, signMessage, router]);

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
    router.refresh(); // reload server components into their signed-out state
  }, [disconnect, router]);

  return (
    <AuthContext.Provider
      value={{ session, loading, signingIn, error, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
