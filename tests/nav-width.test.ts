import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The shared header must be the same width on every page that uses it.
 *
 * It is a three-column grid whose right-hand column wraps, so when a page put
 * it inside a narrow shell the X and GitHub icons wrapped above the "Record a
 * task" button and the whole page looked broken. Nothing in the header itself
 * was wrong — the page around it was narrower than the header needs.
 *
 * Narrow reading or form widths belong on the CONTENT inside the page, never on
 * the shell that contains the header. This test exists because that distinction
 * is invisible when you are writing a new page and copying an old one.
 */

const APP = path.join(process.cwd(), "app");
const SHELL = "max-w-5xl";

function pagesUsingNav(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      pagesUsingNav(full, found);
    } else if (entry === "page.tsx") {
      const src = readFileSync(full, "utf8");
      if (src.includes("<Nav />")) found.push(full);
    }
  }
  return found;
}

describe("page shells", () => {
  const pages = pagesUsingNav(APP);

  it("finds the pages that use the shared header", () => {
    // A sanity check on the crawl itself: if this ever hits zero the test below
    // would pass vacuously and stop protecting anything.
    expect(pages.length).toBeGreaterThan(5);
  });

  it.each(pages.map((p) => [path.relative(APP, p), p] as const))(
    "%s wraps the header in the standard shell",
    (_name, file) => {
      const src = readFileSync(file, "utf8");
      // The first max-w in the file is the outer shell; anything narrower than
      // the standard makes the header wrap.
      const first = src.match(/max-w-[a-z0-9]+/)?.[0];
      expect(first).toBe(SHELL);
    },
  );
});
