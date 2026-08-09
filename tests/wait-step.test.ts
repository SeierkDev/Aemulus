import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { holds, WAIT_OPS, MAX_WAIT_MS, DEFAULT_WAIT_MS } from "../lib/watches";

/**
 * Waiting for a page that is not ready yet.
 *
 * A recording is a straight line through a page the person only touched once
 * they could see it. Replayed at machine speed the same line arrives early, and
 * until now that was a missed element and a stopped run — so a pipeline was
 * only ever as long as the slowest thing in it happened to be fast.
 */

describe("one reading, one answer", () => {
  it("tells a missing element apart from an empty one", () => {
    // The distinction "" cannot carry on its own. A field that exists and says
    // nothing, and a field that has not rendered, are the same string and very
    // different facts about whether the page is ready.
    expect(holds("appears", "", null)).toBe(false);
    expect(holds("appears", "", "")).toBe(false);
    expect(holds("appears", "", "1,204")).toBe(true);
    expect(holds("disappears", "", null)).toBe(true);
    expect(holds("disappears", "", "")).toBe(true);
    expect(holds("disappears", "", "still here")).toBe(false);
  });

  it("refuses to answer a claim about text that is not on the page", () => {
    // Without this, "stops containing" is TRUE for an element that never
    // rendered, and a wait for it passes before the page has drawn anything.
    expect(holds("not_contains", "pending", null)).toBe(false);
    expect(holds("contains", "done", null)).toBe(false);
    expect(holds("equals", "", null)).toBe(false);
    expect(holds("above", "100", null)).toBe(false);
  });

  it("compares text the way a watch does", () => {
    expect(holds("equals", "Approved", "Approved")).toBe(true);
    expect(holds("equals", "Approved", "approved")).toBe(false); // case is not folded
    expect(holds("contains", "ready", "order is ready now")).toBe(true);
    expect(holds("not_contains", "pending", "shipped")).toBe(true);
  });

  it("reads numbers out of formatted values", () => {
    expect(holds("above", "100", "$1,249.00")).toBe(true);
    expect(holds("below", "5", "4.80")).toBe(true);
    expect(holds("below", "5", "6.20")).toBe(false);
  });

  it("says inconclusive when a number was needed and there is none", () => {
    // Not false: a page mid-render is the normal case for a step whose whole
    // job is waiting for the page to finish, so this has to mean "not yet"
    // rather than "this will never happen".
    expect(holds("above", "100", "loading…")).toBeNull();
    expect(holds("below", "5", "—")).toBeNull();
  });

  it("normalizes whitespace before comparing", () => {
    expect(holds("equals", "in review", "  in​   review ")).toBe(true);
  });

  it("does not offer changed", () => {
    // A watch compares this check against the last one. A wait has no previous
    // reading, only the page as it is now, so "changed" would produce a step
    // that fires instantly or never for reasons the author cannot see.
    expect(WAIT_OPS as readonly string[]).not.toContain("changed");
  });
});

describe("a wait is bounded", () => {
  it("caps how long one step can hold its browser", () => {
    // The step keeps its browser and its run slot for the whole duration, so
    // this is a cap on holding the pool open, not a preference.
    expect(MAX_WAIT_MS).toBe(5 * 60 * 1000);
    expect(DEFAULT_WAIT_MS).toBeLessThan(MAX_WAIT_MS);
  });

  it("the runner also stops at the run's own deadline", () => {
    const src = readFileSync("lib/wait.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function waitForStep"));
    expect(fn.slice(0, 1600)).toMatch(/const until = Math\.min\(want, deadline\)/);
  });

  it("the schema refuses an unbounded one", () => {
    const v = readFileSync("lib/validate.ts", "utf8");
    expect(v).toMatch(/waitMs: z\.number\(\)\.int\(\)\.min\(1000\)\.max\(MAX_WAIT_MS\)\.optional\(\)/);
  });
});

describe("the extension waits for the same things", () => {
  const ext = readFileSync("extension/content.js", "utf8");
  const lib = readFileSync("lib/watches.ts", "utf8");

  it("runs the wait before the element-not-found exit", () => {
    // The whole point of a wait is that the element is not there yet. Behind
    // that check, every wait with something to wait for is refused instantly.
    const fn = ext.slice(ext.indexOf("function performStep("));
    const wait = fn.indexOf('action === "wait_for"');
    const notFound = fn.indexOf('reason: "element-not-found"');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(notFound);
  });

  it("copies the number reader exactly", () => {
    // A content script cannot import the server bundle, so this is a copy. A
    // copy that drifts is worse than none: the same skill would wait for
    // different things depending on where it ran.
    const libRe = /match\(\/(-\?\\d\[\\d,\]\*\\\.\?\\d\*)\/\)/.exec(lib);
    const extRe = /match\(\/(-\?\\d\[\\d,\]\*\\\.\?\\d\*)\/\)/.exec(ext);
    expect(libRe).toBeTruthy();
    expect(extRe).toBeTruthy();
    expect(extRe![1]).toBe(libRe![1]);
  });

  it("makes the same missing-element call", () => {
    const fn = ext.slice(ext.indexOf("function aemHolds"), ext.indexOf("const WAIT_POLL_MS"));
    expect(fn).toMatch(/if \(op === "appears"\) return reading !== null && text !== ""/);
    expect(fn).toMatch(/if \(op === "disappears"\) return reading === null \|\| text === ""/);
    expect(fn).toMatch(/if \(reading === null\) return false/);
  });

  it("keeps the service worker alive while it waits", () => {
    // An idle MV3 worker is terminated, and it would take the pending step
    // response with it — the run would die partway through for no visible
    // reason, only on long waits.
    expect(ext).toMatch(/__aem: "waiting"/);
    expect(readFileSync("extension/background.js", "utf8")).toMatch(
      /msg\.__aem === "waiting"/,
    );
  });

  it("answers a long wait asynchronously without changing any other step", () => {
    expect(ext).toMatch(/Promise\.resolve\(performStep\(msg\.step, msg\.value, msg\.forcedSelector\)\)\.then\(reply\)/);
  });
});

describe("a wait that runs out", () => {
  it("never reaches the vision fallback in the extension", async () => {
    // A missed selector means the element moved and vision can find it again.
    // A wait running out means the thing did not happen — not a locating
    // problem. The fallback would spend tokens hunting an element that is not
    // there and could "recover" the step by pointing at something else, so a
    // run the author told to STOP would carry on as if it had arrived.
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg).toMatch(/if \(step\.action !== "wait_for" && \(!res \|\| !res\.ok\)\)/);
    const block = bg.slice(bg.indexOf('if (step.action === "wait_for")'));
    expect(block.slice(0, 900)).toMatch(/status = "needs_review"/);
  });

  it("is recorded as flagged by both runners when it carried on", () => {
    // Same skill, same event, same record. The extension used to file a
    // carried-on wait as a clean success while the cloud flagged it.
    expect(readFileSync("extension/content.js", "utf8")).toMatch(/timedOut: true/);
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg).toMatch(/flagged = !!res\.timedOut/);
    const run = readFileSync("lib/runner.ts", "utf8");
    expect(run).toMatch(/recordStep\(runId, step, w\.selectorUsed, "", recShot, conf, !w\.met, note\)/);
  });
});

describe("a wait with nothing to look at", () => {
  it("is refused where it is set", () => {
    const v = readFileSync("lib/validate.ts", "utf8");
    expect(v).toMatch(/s\.action !== "wait_for" \|\| s\.selectors\.length > 0/);
  });

  it("does not hold a browser for its whole timeout to say so", () => {
    const src = readFileSync("lib/wait.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function waitForStep"));
    expect(fn.slice(0, 1400)).toMatch(/selectors\.length === 0/);
  });
});

describe("a wait is not the run being slow", () => {
  const src = readFileSync("lib/runner.ts", "utf8");

  it("the run's clock is extended by time actually spent waiting", () => {
    // The run timeout defaults to two minutes and the editor offers waits of
    // five, so a deliberate long wait was quietly cut to whatever was left of
    // the run — and reported as the page never getting there.
    expect(src).toMatch(/let waitBudget = MAX_WAIT_MS/);
    const at = src.indexOf('if (step.action === "wait_for") {');
    const block = src.slice(at, at + 700);
    expect(block).toMatch(/const grant = Math\.min\(waitLimit\(step\), waitBudget\)/);
    expect(block).toMatch(/deadline \+= grant/);
  });

  it("hands back what it did not use", () => {
    // Or a wait that returns in two seconds spends five minutes of the budget.
    const at = src.indexOf('if (step.action === "wait_for") {');
    const block = src.slice(at, at + 700);
    expect(block).toMatch(/const unused = Math\.max\(0, grant - w\.elapsed\)/);
    expect(block).toMatch(/deadline -= unused/);
    expect(block).toMatch(/waitBudget \+= unused/);
  });

  it("caps the extension across the whole run, not per step", () => {
    // Per step, a plan full of waits would have no wall clock at all.
    const decl = src.slice(src.indexOf("let waitBudget"), src.indexOf("let waitBudget") + 60);
    expect(decl).toContain("MAX_WAIT_MS");
    expect(src).not.toMatch(/waitBudget = MAX_WAIT_MS;[\s\S]{0,200}waitBudget = MAX_WAIT_MS;/);
  });

  it("says which clock ended it, and how long it really waited", () => {
    // "Waited 5 minutes" after 90 seconds sends you looking at the page for a
    // problem that is not there.
    const w = readFileSync("lib/wait.ts", "utf8");
    const fn = w.slice(w.indexOf("export async function waitForStep"));
    expect(fn).toMatch(/The run ran out of time after \$\{secs\(elapsed\)\}/);
    expect(fn).toMatch(/Waited \$\{secs\(elapsed\)\}/);
  });
});

describe("both runners read an element the same way", () => {
  it("the wait uses the shared reader, not textContent", () => {
    // textContent of an <input> is empty — its value lives elsewhere. Reading
    // it directly meant "wait until the total field says something" timed out
    // in the cloud and passed instantly in the extension, and "wait until it
    // stops showing a value" did the exact reverse.
    const src = readFileSync("lib/wait.ts", "utf8");
    const fn = src.slice(
      src.indexOf("export async function waitForStep"),
      src.indexOf("/** How long this wait may run"),
    );
    expect(fn).toMatch(/await captureValue\(loc, 2000\)/);
    expect(fn).not.toMatch(/loc\.textContent\(/);
  });

  it("that reader still prefers a form value over text", () => {
    const src = readFileSync("lib/page-read.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function captureValue"));
    expect(fn.slice(0, 700)).toMatch(/tag === "input" \|\| tag === "textarea" \|\| tag === "select"/);
    expect(fn.slice(0, 700)).toMatch(/loc\.inputValue\(o\)/);
  });

  it("and both cut a long element at the same place", () => {
    // 4,000 locally against 20,000 in the cloud means a "contains" whose match
    // sits past the cut is satisfied on one side only.
    const ext = readFileSync("extension/content.js", "utf8");
    const wait = ext.slice(ext.indexOf("function waitForStep"), ext.indexOf("function performStep("));
    expect(wait).toMatch(/readValue\(e, 20000\)/);
    expect(readFileSync("lib/page-read.ts", "utf8")).toMatch(/MAX_CAPTURE_CHARS = 20_000/);
  });
});

describe("selectors are alternatives for one element, not a list of chances", () => {
  it("the cloud judges the first selector that finds it, then stops", () => {
    // A recording stores several alternative selectors for the same element.
    // Asking whether ANY of them satisfied made "stops showing a value" true
    // the moment a spare selector stopped matching — while the element was
    // still sitting there under the one that did match.
    const src = readFileSync("lib/wait.ts", "utf8");
    const fn = src.slice(
      src.indexOf("export async function waitForStep"),
      src.indexOf("/** How long this wait may run"),
    );
    expect(fn).toMatch(/if \(r !== null\) \{\s*\n\s*reading = r;\s*\n\s*usedNow = sel;\s*\n\s*break;/);
    // One verdict per poll, on the resolved reading — not one per selector.
    expect(fn.match(/holds\(op, operand, reading\)/g) ?? []).toHaveLength(1);
  });

  it("the extension resolves it the same way", () => {
    const ext = readFileSync("extension/content.js", "utf8");
    const fn = ext.slice(ext.indexOf("function waitForStep"), ext.indexOf("function performStep("));
    expect(fn).toMatch(/if \(r !== null\) \{ reading = r; usedNow = sel; break; \}/);
    expect(fn.match(/aemHolds\(op, operand, reading\)/g) ?? []).toHaveLength(1);
  });

  it("credits the step to the selector that answered", () => {
    // It used to name the first selector that RESOLVED, which is not
    // necessarily the one the verdict came from.
    const src = readFileSync("lib/wait.ts", "utf8");
    const fn = src.slice(
      src.indexOf("export async function waitForStep"),
      src.indexOf("/** How long this wait may run"),
    );
    expect(fn).toMatch(/selectorUsed: usedNow \|\| selectorUsed/);
  });
});

describe("a wait looks at what the page is showing", () => {
  it("the cloud resolves a visible element, like every other step does", () => {
    // The DOM alone is the wrong question in both directions. An overlay hidden
    // with CSS rather than removed still has its text, so "stops showing a
    // value" never fired for the case waits mostly exist for. And "starts
    // showing a value" fired for a still-hidden element, after which the next
    // step — which does require visible — failed to find it.
    const src = readFileSync("lib/wait.ts", "utf8");
    const fn = src.slice(
      src.indexOf("export async function waitForStep"),
      src.indexOf("/** How long this wait may run"),
    );
    expect(fn).toMatch(/\(await loc\.count\(\)\) > 0 && \(await loc\.isVisible\(\)\)/);
    // The same thing ordinary selector resolution asks, over in the runner.
    expect(readFileSync("lib/runner.ts", "utf8")).toMatch(
      /if \(await locator\.isVisible\(\)\) return \{ locator, selector: sel \}/,
    );
  });

  it("the extension uses the same definition of visible", () => {
    // Playwright's: a non-empty box, and not visibility:hidden. display:none
    // has no boxes, so it is covered.
    const ext = readFileSync("extension/content.js", "utf8");
    const fn = ext.slice(ext.indexOf("function aemVisible"), ext.indexOf("const WAIT_POLL_MS"));
    expect(fn).toMatch(/getClientRects\(\)\.length === 0/);
    expect(fn).toMatch(/getComputedStyle\(el\)\.visibility !== "hidden"/);
    const wait = ext.slice(ext.indexOf("function waitForStep"), ext.indexOf("function performStep("));
    expect(wait).toMatch(/found && aemVisible\(found\) \? found : null/);
  });
});

describe("a wait can actually be authored", () => {
  const ed = readFileSync("components/SkillEditor.tsx", "utf8");
  const panel = ed.slice(
    ed.indexOf('{s.action === "wait_for" ? ('),
    ed.indexOf(') : s.action === "run_skill"'),
  );

  it("the wait panel has its own selector field", () => {
    // The only editable selector on this screen lived in the extract panel, so
    // a wait step had no way to be given one — and the save refuses a wait with
    // no selector, which made the feature unusable from the one screen that can
    // author it.
    expect(panel).toMatch(/aria-label=\{`Step \$\{i \+ 1\} wait selector`\}/);
    expect(panel).toMatch(/selectors: \[e\.target\.value, \.\.\.\(s\.selectors\?\.slice\(1\) \?\? \[\]\)\]/);
  });

  it("says why before the save refuses it", () => {
    expect(panel).toMatch(/A wait needs something to look at/);
    expect(panel).toMatch(/!\(s\.selectors\?\.\[0\] \?\? ""\)\.trim\(\)/);
  });

  it("and the save still refuses one without", () => {
    expect(readFileSync("lib/validate.ts", "utf8")).toMatch(
      /s\.action !== "wait_for" \|\| s\.selectors\.length > 0/,
    );
  });
});

describe("what a timed-out wait leaves behind", () => {
  const src = readFileSync("lib/runner.ts", "utf8");
  const block = src.slice(
    src.indexOf('if (step.action === "wait_for") {'),
    src.indexOf('// Skill chaining: start a child run'),
  );

  it("is not recorded as full confidence", () => {
    // Confidence is what the step is worth as evidence, and the record is what
    // the receipt covers. A wait that ran out did not do what it says.
    expect(block).toMatch(/const conf = w\.met \? DETERMINISTIC_CONFIDENCE : 0/);
    expect(block).not.toMatch(/recShot, 1, /);
  });

  it("says so when the page is behind a bot challenge", () => {
    // A wall is a different problem from a slow page. "Last saw nothing there"
    // sends you looking at your selector for something that was never going to
    // arrive.
    expect(block).toMatch(/await isCaptchaPresent\(page\)/);
    expect(block).toMatch(/The page is showing a bot challenge/);
  });

  it("checks for it only when the wait actually failed", () => {
    expect(block).toMatch(/!w\.met && \(await isCaptchaPresent\(page\)\)/);
  });
});
