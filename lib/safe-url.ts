import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard. Aemulus navigates a server-side browser to user/skill-supplied
 * URLs (record start + the runner's navigate steps), so we must refuse any URL
 * that resolves to a private, loopback, link-local, or cloud-metadata address —
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

/** Throws if `raw` is unsafe to navigate to. data: URLs are inline (no fetch). */
export async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (u.protocol === "data:") return; // inline content, no network request
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked URL scheme: ${u.protocol}`);
  }

  const host = u.hostname.toLowerCase();
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
