import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Solana/Anchor workspaces have their own toolchain (Rust + ts-mocha).
    "anchor/**",
    "anchor-zk/**",
    // Vendored third-party bundle (rrweb UMD), copied in at build time.
    "public/vendor/**",
    // The browser extension is a standalone MV3 artifact (chrome.* globals,
    // plain JS) with its own runtime — not part of the Next app's lint pass.
    "extension/**",
  ]),
]);

export default eslintConfig;
