import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard. Aemulus navigates a server-side browser to user/skill-supplied
 * URLs (record start + the runner's navigate steps), so we must refuse any URL
 * that resolves to a private, loopback, link-local, or cloud-metadata address -
 * otherwise a crafted skill could make the server hit internal services or the
 * instance metadata endpoint and screenshot the result.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // ULA
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7)); // mapped v4
    return false;
  }
  return false;
}

/**
 * Fast, synchronous request filter for per-request egress control during a run.
 * Blocks non-http(s) schemes, known-internal hostnames, and literal private IPs
 * - no DNS (kept cheap for every subresource). Top-level navigations still get
 * the full DNS-resolving assertSafeUrl. data:/blob: are inline (allowed).
 */
export function isUnsafeRequestUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (u.protocol === "data:" || u.protocol === "blob:") return false;
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  // strip brackets from IPv6 literals (e.g. "[::1]") so net.isIP recognizes them
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return true;
  if (net.isIP(host) && isPrivateIp(host)) return true;
  return false;
}

/**
 * Per-run egress allowlist check for NAVIGATIONS. A skill declares the hosts it
 * may navigate to; an empty list means unrestricted http/https (back-compat). A
 * host matches an entry exactly or as a subdomain (so "example.com" allows
 * "app.example.com"). data:/blob: are NEVER allowed as a top-level navigation:
 * a data: page is fully attacker-authored content that would otherwise bypass
 * the allowlist (and could capture an auto-filled credential) - they remain fine
 * as subresources, which this function doesn't gate.
 */
export function hostInAllowlist(raw: string, allowed: string[]): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "data:" || u.protocol === "blob:") return false;
  if (allowed.length === 0) return true;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return allowed.some((a) => {
    const d = a.trim().toLowerCase();
    return d !== "" && (host === d || host.endsWith(`.${d}`));
  });
}

// Small TTL cache so the per-navigation DNS check (below) doesn't re-resolve the
// same host on every redirect/click within a run.
const navDnsCache = new Map<string, { priv: boolean; exp: number }>();
const NAV_DNS_TTL_MS = 60_000;

/**
 * For a NAVIGATION request (in-page redirect, clicked link, form post) resolve
 * the host and report whether it points at a private/internal address. The
 * synchronous isUnsafeRequestUrl only blocks literal private IPs (kept cheap for
 * every subresource); this closes the gap where a hostname that RESOLVES private
 * (e.g. intranet.corp.local -> 10.x) is reached via a redirect rather than the
 * DNS-checked navigate action. (Time-of-check/use rebinding remains a documented
 * residual.) Returns false for non-http(s) and unresolvable hosts (those are
 * handled elsewhere).
 */
export async function navHostResolvesPrivate(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) return isPrivateIp(host); // literal IPs already covered, but cheap
  const now = Date.now();
  const cached = navDnsCache.get(host);
  if (cached && cached.exp > now) return cached.priv;
  let priv = false;
  try {
    const addrs = await lookup(host, { all: true });
    priv = addrs.some((a) => isPrivateIp(a.address));
  } catch {
    priv = false; // unresolvable: let Playwright fail the nav normally
  }
  navDnsCache.set(host, { priv, exp: now + NAV_DNS_TTL_MS });
  return priv;
}

/** Throws if `raw` is unsafe to navigate to. data: URLs are inline (no fetch). */
export async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  // data:/blob: as a top-level navigation target is attacker-authored content
  // that bypasses the allowlist and can capture an auto-filled credential - block
  // it (it's still fine as a page subresource, which this guard doesn't gate).
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked URL scheme: ${u.protocol}`);
  }

  // strip brackets from IPv6 literals (e.g. "[::1]") so net.isIP recognizes them
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error("Blocked host.");

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Blocked private address.");
    return;
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve host.");
  }
  if (addrs.length === 0) throw new Error("Could not resolve host.");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("Blocked private address.");
  }
}
