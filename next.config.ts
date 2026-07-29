import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Allow the Solana RPC the client talks to (balance reads + tx confirm) on the
// connect-src. Derived from the configured RPC so it follows a custom endpoint.
const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
let rpcOrigin = "";
try {
  rpcOrigin = new URL(rpc).origin;
} catch {
  /* keep empty */
}
const rpcWss = rpcOrigin.replace(/^https/, "wss");

// Full Content-Security-Policy. The key defense is `script-src` (no injected or
// third-party scripts can execute) on top of the clickjacking + base-uri/
// form-action lockdown. Next's hydration uses inline scripts/styles, so
// 'unsafe-inline' is required; dev (Turbopack/HMR) additionally needs
// 'unsafe-eval' and a websocket.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind inlines styles; the Solana wallet-adapter UI pulls DM Sans from
  // Google Fonts.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:", // screencast/recording frames are data: URLs
  "font-src 'self' https://fonts.gstatic.com",
  [
    "connect-src 'self'",
    rpcOrigin,
    rpcWss,
    "https://*.solana.com",
    "wss://*.solana.com",
    isDev ? "ws:" : "",
  ]
    .filter(Boolean)
    .join(" "),
  "worker-src 'self' blob:",
  // rrweb's run-replay reconstructs the recorded DOM inside a same-origin
  // about:blank iframe. Its content (CSS/images/fonts) is inlined as data: at
  // capture time, so no external hosts are needed here.
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Playwright must run as a real Node dependency, never bundled by Next.
  // The Light + Anchor SDKs are only dynamically imported when the (gated)
  // ZK-compressed receipt path runs, so keep them external too.
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    // Stealth stack — must be required natively, not bundled, or it fails to
    // launch (dynamic requires in the puppeteer-extra plugin graph don't bundle).
    "playwright-extra",
    "puppeteer-extra",
    "puppeteer-extra-plugin-stealth",
    "@lightprotocol/stateless.js",
    "@coral-xyz/anchor",
  ],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
