import type { Page } from "playwright";
import { holds } from "./watches";
import { captureValue, pageIsGone } from "./page-read";
import type { StepCondition } from "./types";

/**
 * Deciding whether a branch runs.
 *
 * Its own module so the decision can be exercised against a real DOM rather
 * than a copy of itself in a test — which is only a test of the copy. The same
 * move the wait needed, for the same reason: everything this answers depends on
 * what a live browser reports about an element that is hidden, missing, or a
 * form field.
 */

/**
 * Evaluate a step's branch condition against the current page.
 *
 * Two questions, not one. Without `op` this is the original presence check and
 * behaves exactly as it did. With one, it asks what the element SAYS, in the
 * same vocabulary a wait and a watch rule use — so "if the total is above 100"
 * is one question with one answer wherever it is asked, and reads a VISIBLE
 * element for the same reason a wait does.
 */
export async function conditionMet(page: Page, cond: StepCondition): Promise<boolean> {
  if (cond.op) {
    let reading: string | null = null;
    try {
      const loc = page.locator(cond.selector).first();
      const there = (await loc.count()) > 0 && (await loc.isVisible());
      reading = there ? await captureValue(loc, 2000) : null;
    } catch (e) {
      if (pageIsGone(page, e)) throw e;
      reading = null; // invalid selector → not on the page
    }
    // Inconclusive is not a reason to run: a branch that cannot be judged must
    // not take the path that DOES something on the strength of not knowing.
    return holds(cond.op, cond.value ?? "", reading) === true;
  }
  let present = false;
  try {
    present = (await page.locator(cond.selector).count()) > 0;
  } catch (e) {
    if (pageIsGone(page, e)) throw e;
    present = false; // invalid selector → treat as not present
  }
  return cond.kind === "exists" ? present : !present;
}
