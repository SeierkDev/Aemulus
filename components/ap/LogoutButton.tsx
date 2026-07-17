"use client";

import { useRouter } from "next/navigation";

export function LogoutButton({ kind }: { kind: "email" | "wallet" }) {
  const router = useRouter();
  async function logout() {
    // Email accounts and wallet sessions use different cookies/endpoints.
    await fetch(kind === "wallet" ? "/api/auth/logout" : "/api/ap/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/ap/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="text-ink-3 underline decoration-border-strong underline-offset-2 hover:text-ink">
      Sign out
    </button>
  );
}
