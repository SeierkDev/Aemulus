import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A lint, not a behaviour test.
 *
 * Per-version analytics are only as good as the stamping. A run created without
 * skillVersion is indistinguishable from one made before the column existed, so
 * a new code path that forgets it doesn't break anything loudly — it quietly
 * files today's runs under "ran before versions were tracked" forever.
 */
const CALLERS = [
  "lib/run-service.ts",
  "lib/chain.ts",
  "app/api/ext/runs/start/route.ts",
];

describe("every path that creates a run stamps the skill version", () => {
  it("passes skillVersion at each call site", () => {
    for (const f of CALLERS) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} calls createRun`).toMatch(/createRun\(/);
      expect(src, `${f} must pass skillVersion`).toMatch(/skillVersion:/);
    }
  });

  // If a fourth call site appears, it has to be added above deliberately rather
  // than silently producing unversioned runs.
  it("knows about every call site there is", () => {
    const files = [
      "lib/run-service.ts", "lib/chain.ts", "lib/runs.ts", "lib/worker.ts",
      "lib/scheduler.ts", "app/api/ext/runs/start/route.ts",
    ];
    const callers = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /(?<!function )createRun\(/.test(src) && !/export async function createRun/.test(src.slice(0, src.indexOf("createRun(")));
    });
    for (const c of callers) {
      if (c === "lib/runs.ts") continue; // where it is defined
      expect(CALLERS, `${c} creates runs but is not covered`).toContain(c);
    }
  });
});
