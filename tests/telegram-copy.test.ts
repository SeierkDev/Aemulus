import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A lint, not a behaviour test.
 *
 * Everything the bot sends with markdown:true must have balanced * and `
 * markers. Telegram rejects an unbalanced message with a 400, so the failure is
 * not a mangled message, it is no message at all. Copy gets rewritten far more
 * often than logic does, and this is the one way to get it wrong that leaves no
 * trace in a normal test run.
 */
function bare(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch && s[i - 1] !== "\\") n++;
  }
  return n;
}

describe("markdown balance in bot copy", () => {
  it("has balanced markers in every literal string", () => {
    const files = [
      "lib/telegram-commands.ts",
      "lib/watch-sink-telegram.ts",
      "app/api/telegram/webhook/route.ts",
    ];
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Double-quoted literals only; template literals interpolate values that
      // are escaped at runtime.
      for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const lit = m[1];
        if (!lit.includes("*") && !lit.includes("`")) continue;
        if (bare(lit, "*") % 2 !== 0) bad.push(`${f}: odd *  ->  ${lit}`);
        if (bare(lit, "`") % 2 !== 0) bad.push(`${f}: odd \`  ->  ${lit}`);
      }
    }
    if (bad.length) console.log(bad.join("\n"));
    expect(bad).toEqual([]);
  });
});
