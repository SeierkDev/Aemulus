"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";

export function LogoutButton() {
  const router = useRouter();
  const { signOut } = useAuth();
  async function logout() {
    // Route through auth-context.signOut so the CLIENT session state is cleared
    // (and the wallet disconnected), not just the server cookie. A bare fetch left
    // useAuth().session stale/non-null, so the sign-in page's `if (session)` effect
    // bounced the just-logged-out user straight back to /ap/queue — an infinite
    // /ap/login ⇄ /ap/queue redirect loop — and every client gate still read "signed in".
    await signOut();
    router.replace("/ap/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="text-ink-3 underline decoration-border-strong underline-offset-2 hover:text-ink">
      Sign out
    </button>
  );
}
