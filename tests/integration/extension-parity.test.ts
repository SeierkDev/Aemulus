import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { conditionMet } from "../../lib/branch";
import type { StepCondition } from "../../lib/types";

/**
 * The extension's copy of the decision, actually executed.
 *
 * A content script cannot import the server bundle, so branches and waits are
 * judged by a second implementation living in extension/content.js. Until now
 * that copy was only ever pinned by source text — nothing ran it, and matching
 * source is not the same claim as matching answers.
 *
 * So this lifts those functions out of the extension and runs them in a real
 * page, against the same DOM the library sees, and compares the two answers.
 * A drift between them is a skill that does different work depending on where
 * it ran, which is the failure this whole feature keeps producing.
 */

/** Pull one `function NAME(...) {...}` out of a source file by matching braces. */
function lift(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`extension/content.js no longer defines ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`could not find the end of ${name}()`);
}

/** Pull one `const NAME = ...;` line out, for the values those functions close over. */
function liftConst(src: string, name: string): string {
  const m = new RegExp(`^\\s*const ${name} = .*$`, "m").exec(src);
  if (!m) throw new Error(`extension/content.js no longer defines ${name}`);
  return m[0].trim();
}

let browser: Browser;
let page: Page;
let bundle: string;

beforeAll(async () => {
  const src = readFileSync("extension/content.js", "utf8");
  bundle = [
    liftConst(src, "CAPTURE_VALUE_MAX"),
    liftConst(src, "AEM_ZERO_WIDTH"),
    lift(src, "readValue"),
    lift(src, "aemNormalize"),
    lift(src, "aemNumber"),
    lift(src, "aemHolds"),
    lift(src, "aemVisible"),
    lift(src, "conditionMet"),
    "window.__ext = { conditionMet, aemHolds, aemVisible, readValue };",
  ].join("\n\n");

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Both answers for the same page and the same condition. */
async function both(html: string, cond: StepCondition) {
  await page.setContent(html);
  // Injected after the content, so the functions live in the same document the
  // library is about to read.
  await page.addScriptTag({ content: bundle });
  const ext = await page.evaluate(
    (c) => (window as unknown as { __ext: { conditionMet: (x: unknown) => boolean } }).__ext.conditionMet(c),
    cond as never,
  );
  const lib = await conditionMet(page, cond);
  return { ext, lib };
}

const AGREE: [string, string, StepCondition][] = [
  ["a number it can read", `<div id="t">$1,249.00</div>`, { kind: "exists", selector: "#t", op: "above", value: "100" }],
  ["a number below", `<div id="t">4.80</div>`, { kind: "exists", selector: "#t", op: "below", value: "5" }],
  ["text that matches", `<div id="t">Approved</div>`, { kind: "exists", selector: "#t", op: "equals", value: "Approved" }],
  ["case is not folded", `<div id="t">approved</div>`, { kind: "exists", selector: "#t", op: "equals", value: "Approved" }],
  ["a substring", `<div id="t">order is ready</div>`, { kind: "exists", selector: "#t", op: "contains", value: "ready" }],
  ["a missing substring", `<div id="t">shipped</div>`, { kind: "exists", selector: "#t", op: "not_contains", value: "pending" }],
  ["an element with text", `<div id="t">here</div>`, { kind: "exists", selector: "#t", op: "appears" }],
  ["an element with none", `<div id="t"></div>`, { kind: "exists", selector: "#t", op: "appears" }],
  ["nothing showing", `<div id="t"></div>`, { kind: "exists", selector: "#t", op: "disappears" }],
  ["an element that is gone", `<p>elsewhere</p>`, { kind: "exists", selector: "#t", op: "disappears" }],
  ["display:none", `<div id="t" style="display:none">Approved</div>`, { kind: "exists", selector: "#t", op: "equals", value: "Approved" }],
  ["visibility:hidden", `<div id="t" style="visibility:hidden">Approved</div>`, { kind: "exists", selector: "#t", op: "appears" }],
  ["a form field's value", `<input id="t" value="42">`, { kind: "exists", selector: "#t", op: "above", value: "40" }],
  ["an empty form field", `<input id="t" value="">`, { kind: "exists", selector: "#t", op: "appears" }],
  ["a textarea", `<textarea id="t">Approved</textarea>`, { kind: "exists", selector: "#t", op: "contains", value: "prove" }],
  ["a number it cannot read", `<div id="t">loading…</div>`, { kind: "exists", selector: "#t", op: "above", value: "100" }],
  ["a claim about text that is not there", `<p>x</p>`, { kind: "exists", selector: "#t", op: "not_contains", value: "pending" }],
  ["collapsed whitespace", `<div id="t">  in   review </div>`, { kind: "exists", selector: "#t", op: "equals", value: "in review" }],
  ["presence, plainly", `<div id="t">x</div>`, { kind: "exists", selector: "#t" }],
  ["absence, plainly", `<p>x</p>`, { kind: "absent", selector: "#t" }],
  ["presence ignores hiding", `<div id="t" style="display:none">x</div>`, { kind: "exists", selector: "#t" }],
  ["an unreadable selector", `<div id="t">x</div>`, { kind: "exists", selector: "<<<nonsense" }],
  ["an unreadable selector, with an operator", `<div id="t">x</div>`, { kind: "exists", selector: "<<<nonsense", op: "appears" }],
  ["the first of several matches", `<div class="s">pending</div><div class="s">Approved</div>`, { kind: "exists", selector: ".s", op: "equals", value: "pending" }],
];

describe("both runners answer the same question the same way", () => {
  for (const [what, html, cond] of AGREE) {
    it(what, async () => {
      const { ext, lib } = await both(html, cond);
      // Keyed the same on both sides on purpose: a failure has to print WHICH
      // case drifted, not just "true !== false".
      expect({ case: what, answer: ext }).toEqual({ case: what, answer: lib });
    });
  }
});

describe("the lift itself", () => {
  it("fails loudly if the extension stops defining what it copies", () => {
    const src = readFileSync("extension/content.js", "utf8");
    for (const fn of ["readValue", "aemNormalize", "aemNumber", "aemHolds", "aemVisible", "conditionMet"]) {
      expect(() => lift(src, fn)).not.toThrow();
    }
    for (const c of ["CAPTURE_VALUE_MAX", "AEM_ZERO_WIDTH"]) {
      expect(() => liftConst(src, c)).not.toThrow();
    }
    expect(() => lift(src, "aemSomethingThatIsNotThere")).toThrow(/no longer defines/);
    expect(() => liftConst(src, "AEM_NOT_A_THING")).toThrow(/no longer defines/);
  });
});
