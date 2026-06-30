import type { NextConfig } from "next";

// Security response headers. The critical one for a wallet-signing dapp is
// clickjacking protection (X-Frame-Options + frame-ancestors) so the signing UI
// can't be invisibly framed over decoy content. The CSP here uses only
// non-script directives (frame-ancestors/object-src/base-uri/form-action) so it
// can't break Next's hydration or the wallet adapter; a full nonce-based
// script-src CSP is a follow-up (needs middleware nonces).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Playwright must run as a real Node dependency, never bundled by Next.
  serverExternalPackages: ["playwright", "playwright-core"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
