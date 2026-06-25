import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright must run as a real Node dependency, never bundled by Next.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
