"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/ap/auth/logout", { method: "POST" });
    router.replace("/ap/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="text-ink-3 underline decoration-border-strong underline-offset-2 hover:text-ink">
      Sign out
    </button>
  );
}
