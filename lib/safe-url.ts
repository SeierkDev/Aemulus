import { lookup } from "node:dns/promises";
import { lookup as lookupCb } from "node:dns";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import net, { type LookupFunction } from "node:net";

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

/**
 * If `ip` is an IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d,
 * deprecated) IPv6 address in ANY textual form — compressed hex (::ffff:7f00:1),
 * dotted (::ffff:127.0.0.1), or fully expanded (0:0:0:0:0:ffff:7f00:1) — return the
 * embedded dotted-quad IPv4, else null. The socket layer connects a mapped literal
 * to that IPv4, so isPrivateIp must decode every form; the old code only handled the
 * "::ffff:" + dotted-quad case, letting ::ffff:7f00:1 (== 127.0.0.1) slip through as
 * public and defeat every SSRF guard.
 */
function embeddedIPv4(ip: string): string | null {
  const s = ip.toLowerCase().split("%")[0];
  if (!net.isIPv6(s)) return null;
  // Peel off an embedded dotted-quad tail (if any) into its two 16-bit groups.
  let hexPart = s;
  let tail: number[] = [];
  const dq = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (dq) {
    const q = dq[2].split(".").map(Number);
    if (q.some((n) => n > 255)) return null;
    hexPart = dq[1];
    tail = [((q[0] << 8) | q[1]) & 0xffff, ((q[2] << 8) | q[3]) & 0xffff];
  }
  // Expand "::" and parse the hex groups into a full 8-group vector.
  let groups: number[];
  const dbl = hexPart.indexOf("::");
  if (dbl >= 0) {
    const left = hexPart.slice(0, dbl).split(":").filter(Boolean).map((g) => parseInt(g, 16));
    const right = hexPart.slice(dbl + 2).split(":").filter(Boolean).map((g) => parseInt(g, 16));
    const missing = 8 - left.length - right.length - tail.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill(0), ...right, ...tail];
  } else {
    groups = [...hexPart.split(":").filter(Boolean).map((g) => parseInt(g, 16)), ...tail];
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const compat = groups.slice(0, 6).every((g) => g === 0) && (groups[6] !== 0 || groups[7] !== 0);
  if (!mapped && !compat) return null;
  const g6 = groups[6], g7 = groups[7];
  return [(g6 >> 8) & 255, g6 & 255, (g7 >> 8) & 255, g7 & 255].join(".");
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 240) return true; // 240.0.0.0/4 reserved + 255.255.255.255 broadcast
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
    if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 anycast
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // ULA
    if (low.startsWith("fe80")) return true; // link-local
    // IPv4-mapped/compatible IPv6 in ANY form routes to the embedded IPv4 at the
    // socket layer — decode and re-check it (::ffff:7f00:1 == 127.0.0.1, etc.).
    const v4 = embeddedIPv4(ip);
    if (v4) return isPrivateIp(v4);
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

/**
 * A DNS lookup hook that REJECTS any resolution to a private/internal address.
 * Passed as the socket's `lookup`, so the address that gets validated is exactly
 * the address the request connects to — closing the DNS-rebinding TOCTOU where a
 * separate assertSafeUrl() check and the connection resolve the host independently
 * (an attacker controlling their own DNS could return public then private).
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  type Cb = (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  const cb = callback as Cb;
  (lookupCb as unknown as (h: string, o: unknown, c: Cb) => void)(hostname, options, (err, address, family) => {
    if (err) return cb(err, address, family);
    const addrs = Array.isArray(address) ? address.map((a) => a.address) : [address as string];
    if (addrs.some((a) => isPrivateIp(a))) {
      return cb(Object.assign(new Error("Blocked private address."), { code: "EBLOCKED" }), [], family);
    }
    cb(err, address, family);
  });
};

/**
 * SSRF-safe JSON POST to a user-supplied URL (e.g. an outbound webhook). Unlike
 * `fetch(url)` — which resolves DNS a second time, independently of any prior
 * assertSafeUrl() — this pins resolution through guardedLookup, so the validated
 * IP IS the connected IP. Never follows redirects (node http doesn't auto-follow),
 * discards the response body (a hostile endpoint can't stream an unbounded body),
 * and enforces a hard timeout. Resolves { status } or rejects on a connect/timeout
 * /blocked-address error.
 */
export function safePostJson(
  raw: string,
  opts: { body: string; headers: Record<string, string>; timeoutMs: number },
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return reject(new Error("Invalid URL."));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return reject(new Error("Blocked URL scheme."));
    }
    const requestFn = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(
      raw,
      {
        method: "POST",
        headers: { ...opts.headers, "content-length": Buffer.byteLength(opts.body) },
        lookup: guardedLookup,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // drain + discard — never buffer a hostile response body
        res.on("end", () => resolve({ status }));
        res.on("error", () => resolve({ status })); // have the status; ignore body errors
      },
    );
    req.on("timeout", () => req.destroy(new Error("Delivery timed out.")));
    req.on("error", (e) => reject(e));
    req.write(opts.body);
    req.end();
  });
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
