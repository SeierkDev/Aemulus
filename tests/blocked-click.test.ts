import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { isBlockedError, isCovered } from "../lib/runner";
import { runLaunchOptions } from "../lib/sandbox";

/**
 * A click that never lands.
 *
 * The element is found, visible and enabled, so nothing upstream treats it as a
 * failure — and then an overlay swallows every click until the step times out
 * and the run dies. That is what happened on a real run: Google served its EU
 * cookie-consent wall to the server, Playwright spent the full 20 seconds
 * retrying, and the run failed on a dialog a person would have dismissed in one
 * click. The error text asserted below is copied verbatim from that run.
 */

describe("isBlockedError", () => {
  // Verbatim from the failing run. If this ever stops being recognised, the
  // agent never gets asked and the run dies again for the same reason.
  const REAL = `locator.click: Timeout 20000ms exceeded.
Call log:
  - waiting for locator('#APjFqb').first()
  - locator resolved to <textarea name="q" id="APjFqb" ...></textarea>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <li class="gowsYd M6j9qf">Nieuwe services ontwikkelen en verbeteren</li> from <div class="LSCOAf">…</div> subtree intercepts pointer events
    - retrying click action`;

  it("recognises the consent-wall failure that started all this", () => {
    expect(isBlockedError(new Error(REAL))).toBe(true);
  });

  it("recognises the interception message on its own", () => {
    expect(
      isBlockedError(new Error("<div> from <body> subtree intercepts pointer events")),
    ).toBe(true);
  });

  // The whole point is to separate "something is in the way" from every other
  // failure. Treating an ordinary error as blocked would send a doomed step to
  // the model and bill for it.
  it("does not treat unrelated failures as blocked", () => {
    for (const m of [
      "locator.click: Target closed",
      "page.goto: net::ERR_NAME_NOT_RESOLVED",
      "Timeout 30000ms exceeded while waiting for navigation",
      "strict mode violation: resolved to 3 elements",
    ]) {
      expect(isBlockedError(new Error(m)), m).toBe(false);
    }
  });

  it("survives a non-Error being thrown", () => {
    expect(isBlockedError("boom")).toBe(false);
    expect(isBlockedError(null)).toBe(false);
    expect(isBlockedError(undefined)).toBe(false);
  });
});

describe("isCovered (real browser)", () => {
  let browser: Browser | null = null;
  let page: Page;
  let ok = false;

  beforeAll(async () => {
    browser = await chromium.launch(runLaunchOptions()).catch(() => null);
    if (!browser) return;
    ok = true;
    page = await (await browser.newContext()).newPage();
  }, 120_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("says no when the button is genuinely clickable", async () => {
    if (!ok) return;
    await page.setContent(`<button id="b" style="width:200px;height:60px">Go</button>`);
    expect(await isCovered(page.locator("#b"))).toBe(false);
  }, 30_000);

  // The consent-wall shape: a fixed overlay sitting on top of the control.
  it("says yes when an overlay is on top of it", async () => {
    if (!ok) return;
    await page.setContent(`
      <button id="b" style="position:absolute;top:100px;left:100px;width:200px;height:60px">Go</button>
      <div id="wall" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>
    `);
    expect(await isCovered(page.locator("#b"))).toBe(true);
  }, 30_000);

  // Guardrails against false positives, which would push perfectly good clicks
  // through the model for no reason.
  it("does not flag a child element sitting inside the target", async () => {
    if (!ok) return;
    await page.setContent(`
      <button id="b" style="width:220px;height:60px"><span style="pointer-events:auto">Go</span></button>
    `);
    expect(await isCovered(page.locator("#b"))).toBe(false);
  }, 30_000);

  it("does not flag a label wrapping its own input", async () => {
    if (!ok) return;
    await page.setContent(`
      <label id="l" style="display:block;width:220px;height:40px">
        Accept <input id="i" type="checkbox">
      </label>
    `);
    expect(await isCovered(page.locator("#i"))).toBe(false);
  }, 30_000);

  it("returns false rather than throwing on a detached element", async () => {
    if (!ok) return;
    await page.setContent(`<button id="b">Go</button>`);
    const loc = page.locator("#b");
    await page.evaluate(() => document.getElementById("b")?.remove());
    expect(await isCovered(loc)).toBe(false);
  }, 30_000);
});
