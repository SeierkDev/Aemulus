"use client";

import { usePathname } from "next/navigation";

/** Hides global chrome (e.g. the token banner) on the AP control surface. */
export function HideOnAp({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/ap")) return null;
  return <>{children}</>;
}
