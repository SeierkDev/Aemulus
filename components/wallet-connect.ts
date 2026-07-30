"use client";

/**
 * Mobile wallet connect.
 *
 * A normal mobile browser has no injected Solana wallet, so the wallet-adapter
 * modal is empty ("you'll need a wallet on Solana to continue"). The fix is to
 * deep-link into the Phantom app, which reopens this exact page inside Phantom's
 * in-app browser — where the wallet IS injected, so the normal connect + SIWS
 * sign-in flow works. On desktop (or already inside a wallet browser) we fall
 * through to the usual modal.
 */

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

/** A wallet is injected: a desktop extension, or Phantom's in-app browser. */
export function hasInjectedWallet(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { solana?: unknown; phantom?: unknown };
  return !!w.solana || !!w.phantom;
}

/** Phantom universal link that reopens this page inside Phantom's browser. */
export function phantomBrowseLink(): string {
  const url = window.location.href;
  const ref = window.location.origin;
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
}

/**
 * If we're on a mobile browser with no injected wallet, redirect into Phantom and
 * return true (the caller should NOT open the wallet modal). Otherwise return
 * false so the caller opens the modal as usual.
 */
export function maybePhantomDeepLink(): boolean {
  if (isMobileDevice() && !hasInjectedWallet()) {
    window.location.href = phantomBrowseLink();
    return true;
  }
  return false;
}
