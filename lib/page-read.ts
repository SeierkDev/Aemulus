import type { Locator, Page } from "playwright";

/**
 * Reading a value off the page.
 *
 * Its own module because two very different callers need to agree exactly: an
 * extract step, which captures the value into the run's output, and a wait,
 * which asks whether the page is there yet. When they disagreed, the same skill
 * behaved differently depending on which one was looking.
 */

export const MAX_CAPTURE_CHARS = 20_000;

/**
 * Did this fail because the SELECTOR is unusable, or because the page is gone?
 *
 * "Not on the page" is the right answer for a selector that matches nothing or
 * cannot be parsed. It is the wrong answer for a browser that has crashed or
 * closed: a branch would answer false and skip its whole group, a wait would
 * report that the page never got there, and a run that did nothing could finish
 * saying so in terms that point at the selector. The step-level catch already
 * fails a run properly — the error just has to reach it.
 */
export function pageIsGone(page: Page, e: unknown): boolean {
  if (page.isClosed()) return true;
  const m = e instanceof Error ? e.message : String(e);
  return /closed|crashed|Target page, context or browser/i.test(m);
}

/**
 * Read a value off an element: form value for inputs, else visible text.
 *
 * Shared with waits, which is the point. A wait that read textContent directly
 * saw NOTHING for an input, a textarea or a select — textContent of a form
 * field is empty, its value lives elsewhere — while the extension's replay read
 * the value and saw the text. So "wait until the total field says something"
 * passed instantly in your own browser and timed out in the cloud, and
 * "wait until it stops showing a value" did the exact reverse.
 */
export async function captureValue(loc: Locator, timeout?: number): Promise<string> {
  const o = timeout ? { timeout } : undefined;
  let raw = "";
  try {
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase(), undefined, o);
    if (tag === "input" || tag === "textarea" || tag === "select") {
      raw = (await loc.inputValue(o)).trim();
    } else {
      raw = ((await loc.textContent(o)) ?? "").trim();
    }
  } catch {
    raw = ((await loc.textContent(o)) ?? "").trim();
  }
  return raw.slice(0, MAX_CAPTURE_CHARS);
}
