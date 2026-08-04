import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * The live checks: a real browser and a real model call, against real pages.
 *
 * Separate from the suite on purpose. They cost money, need network, and are
 * only as reliable as the pages they point at — none of which belongs in a
 * check that has to pass on every commit. Run by hand when the thing they
 * verify has changed.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd()) } },
  test: {
    environment: "node",
    include: ["tests/live/**/*.check.ts"],
    setupFiles: ["./tests/setup-db.ts"],
    testTimeout: 180_000,
    env: { AEMULUS_RUN_TIMEOUT_MS: "150000" },
  },
});
