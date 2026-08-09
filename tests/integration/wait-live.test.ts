import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { waitForStep } from "../../lib/wait";
import type { SkillStep } from "../../lib/types";

/**
 * The wait, against a real DOM.
 *
 * Every other check on this feature reasons about the source. That could not
 * reach the one thing all of it depends on: what a live browser actually
 * reports for an element that is hidden, or missing, or a form field. Three of
 * the bugs found in this feature were exactly that, and none of them would have
 * survived this file.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const step = (p: Partial<SkillStep>): SkillStep =>
  ({
    idx: 0,
    intent: "wait",
    action: "wait_for",
    selectors: ["#target"],
    target: "",
    valueSource: "none",
    value: "",
    inputKey: "",
    key: "",
    waitMs: 2000,
    ...p,
  }) as SkillStep;

const FAR = () => Date.now() + 60_000;

describe("waiting for something that arrives", () => {
  it("returns as soon as it shows up, not when the timeout ends", async () => {
    await page.setContent(`<div id="host"></div>
      <script>setTimeout(() => {
        document.getElementById('host').innerHTML = '<div id="target">ready</div>';
      }, 400)</script>`);
    const t0 = Date.now();
    const r = await waitForStep(page, step({ waitOp: "appears" }), FAR());
    expect(r.met).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1800);
    expect(r.selectorUsed).toBe("#target");
  });

  it("times out when it never does, and says what it saw", async () => {
    await page.setContent(`<div id="target"></div>`);
    const r = await waitForStep(page, step({ waitOp: "appears", waitMs: 1000 }), FAR());
    expect(r.met).toBe(false);
    expect(r.note).toMatch(/Waited \d+s for appears/);
    expect(r.cutShort).toBe(false);
  });
});

describe("hidden is not gone, and not there either", () => {
  it("does not call a hidden element 'showing a value'", async () => {
    // It is in the DOM with text. Every ordinary step resolves only VISIBLE
    // elements, so passing here would hand the next step something it cannot
    // find — which is the thing the wait exists to prevent.
    await page.setContent(`<div id="target" style="display:none">ready</div>`);
    const r = await waitForStep(page, step({ waitOp: "appears", waitMs: 800 }), FAR());
    expect(r.met).toBe(false);
  });

  it("treats an overlay hidden with CSS as gone", async () => {
    // The canonical wait: a spinner that is hidden rather than removed. Reading
    // the DOM alone, its text is still there and this never fires.
    await page.setContent(`<div id="target">loading…</div>
      <script>setTimeout(() => {
        document.getElementById('target').style.visibility = 'hidden';
      }, 300)</script>`);
    const r = await waitForStep(page, step({ waitOp: "disappears" }), FAR());
    expect(r.met).toBe(true);
  });
});

describe("a form field", () => {
  it("is read by its value, not its text", async () => {
    // textContent of an <input> is empty. Read that way, this wait never fires
    // in the cloud while the extension's replay satisfies it immediately.
    await page.setContent(`<input id="target" value="1,249.00">`);
    const r = await waitForStep(page, step({ waitOp: "above", waitValue: "100" }), FAR());
    expect(r.met).toBe(true);
  });

  it("and an empty one has not appeared", async () => {
    await page.setContent(`<input id="target" value="">`);
    const r = await waitForStep(page, step({ waitOp: "appears", waitMs: 800 }), FAR());
    expect(r.met).toBe(false);
  });
});

describe("several selectors are alternatives for one element", () => {
  it("a spare selector that matches nothing cannot report it gone", async () => {
    // The element is right there under the second selector. Asking whether ANY
    // selector satisfied made this fire immediately on the first one.
    await page.setContent(`<div id="real">still here</div>`);
    const r = await waitForStep(
      page,
      step({ selectors: ["#gone-in-a-redesign", "#real"], waitOp: "disappears", waitMs: 800 }),
      FAR(),
    );
    expect(r.met).toBe(false);
  });

  it("falls through to the next one when the first is missing", async () => {
    await page.setContent(`<div id="real">ready</div>`);
    const r = await waitForStep(
      page,
      step({ selectors: ["#gone-in-a-redesign", "#real"], waitOp: "appears" }),
      FAR(),
    );
    expect(r.met).toBe(true);
    expect(r.selectorUsed).toBe("#real");
  });

  it("an invalid selector is not on the page, not a crash", async () => {
    await page.setContent(`<div id="real">ready</div>`);
    const r = await waitForStep(
      page,
      step({ selectors: ["<<<not a selector", "#real"], waitOp: "appears" }),
      FAR(),
    );
    expect(r.met).toBe(true);
  });
});

describe("the run's clock", () => {
  it("cuts the wait short and says it was the run, not the page", async () => {
    await page.setContent(`<div id="other">nothing yet</div>`);
    const r = await waitForStep(
      page,
      step({ waitOp: "appears", waitMs: 60_000 }),
      Date.now() + 700, // the run is nearly out of time
    );
    expect(r.met).toBe(false);
    expect(r.cutShort).toBe(true);
    expect(r.note).toMatch(/The run ran out of time after \d+s of a 60s wait/);
  });
});

describe("a wait with nothing to look at", () => {
  it("says so immediately instead of holding the browser", async () => {
    await page.setContent(`<div id="target">here</div>`);
    const t0 = Date.now();
    const r = await waitForStep(page, step({ selectors: [], waitMs: 60_000 }), FAR());
    expect(r.met).toBe(false);
    expect(r.note).toMatch(/nothing to look at/);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
