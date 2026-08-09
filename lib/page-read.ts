import type { Locator } from "playwright";

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
