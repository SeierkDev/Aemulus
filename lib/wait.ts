import type { Page } from "playwright";
import { holds, DEFAULT_WAIT_MS, MAX_WAIT_MS } from "./watches";
import { captureValue, pageIsGone } from "./page-read";
import type { SkillStep } from "./types";

/**
 * Waiting for a page to be ready.
 *
 * Its own module so it can be exercised against a real DOM rather than only
 * reasoned about — the class of mistake the rest of this feature\'s checks
 * could not reach, since every one of them was about what a live browser
 * actually reports.
 */

// How often a wait_for step re-reads the page. Fast enough that a wait does not
// add a visible delay of its own once the thing arrives, slow enough that a
// five-minute wait is not thousands of DOM reads.
export const WAIT_POLL_MS = 500;

export type WaitOutcome = {
  met: boolean;
  note: string;
  selectorUsed: string;
  elapsed: number;
  cutShort: boolean;
};

/**
 * Hold until the page satisfies the step, or until time runs out.
 *
 * Polled rather than handed to Playwright's own waiters, because the predicate
 * is the SAME vocabulary a watch rule uses — "goes above 100" is a question
 * about the text in an element, not a state Playwright knows about. One
 * implementation of what an operator means, in lib/watches, used by both.
 *
 * Bounded twice over: by the step's own limit and by the run's deadline, so a
 * skill full of long waits cannot outlive the run that contains it or hold its
 * browser past the wall clock.
 */
export async function waitForStep(
  page: Page,
  step: SkillStep,
  deadline: number,
): Promise<WaitOutcome> {
  const op = String(step.waitOp ?? "appears");
  const operand = step.waitValue ?? "";
  const limit = waitLimit(step);
  const started = Date.now();
  const want = started + limit;
  // Whichever comes first, remembered so the note can say which. The run's own
  // wall clock is shorter than the longest wait the editor offers, and a step
  // that reported "waited 5 minutes" after 90 seconds because the RUN ran out
  // sends you looking at the page for a problem that is not there.
  const until = Math.min(want, deadline);
  const cutShort = () => until < want;
  const selectors = step.selectors ?? [];
  // Nothing to look at: say so now rather than holding the browser for the full
  // timeout to reach the same answer. The save path refuses these, so this is
  // for a plan that arrived some other way.
  if (selectors.length === 0) {
    return {
      met: false,
      note: "This wait has nothing to look at.",
      selectorUsed: "",
      elapsed: 0,
      cutShort: false,
    };
  }
  let selectorUsed = "";
  let last: string | null = null;

  for (;;) {
    // Resolve the element the way every other step does: the recorded selectors
    // are ALTERNATIVE ways to find one thing, so the first that finds it wins
    // and its reading is the one judged.
    //
    // Asking whether ANY selector satisfied instead was wrong in a way that
    // only showed on "stops showing a value": a selector that matches nothing
    // reads as gone, and a recording stores several alternatives, so the wait
    // was satisfied on the first spare selector that no longer matched — while
    // the element was still sitting there under the one that did. It also
    // credited the step to the first selector that RESOLVED rather than the one
    // that actually answered.
    let reading: string | null = null;
    let usedNow = "";
    for (const sel of selectors) {
      let r: string | null = null;
      try {
        const loc = page.locator(sel).first();
        // VISIBLE, like every other step in this runner resolves a selector.
        //
        // The DOM alone was the wrong question in both directions. A loading
        // overlay hidden with CSS rather than removed still has its text, so
        // "stops showing a value" never fired for the case waits mostly exist
        // for. And "starts showing a value" fired for an element that was still
        // hidden — after which the next step, which does require visible,
        // failed to find it. Preventing exactly that is the wait's job.
        //
        // Bounded well under the poll's own cadence: these reads auto-wait, so
        // an element that detaches between the check and the read would
        // otherwise stall this tick for the whole default step timeout.
        const there = (await loc.count()) > 0 && (await loc.isVisible());
        r = there ? await captureValue(loc, 2000) : null;
      } catch (e) {
        // A dead browser is not a page that has not got there yet. Left as
        // "nothing there", the note blames the selector for a crash — and with
        // "carry on anyway" the run marches into a browser that is gone.
        if (pageIsGone(page, e)) throw e;
        r = null; // invalid selector reads as "not on the page"
      }
      if (r !== null) {
        reading = r;
        usedNow = sel;
        break;
      }
    }
    // The last thing actually READ, for the timeout note. Not finding the
    // element says nothing about what the page was showing, so it does not
    // overwrite a real reading.
    if (reading !== null) {
      last = reading;
      selectorUsed = usedNow;
    }
    if (holds(op, operand, reading) === true) {
      return {
        met: true,
        note: `Waited ${secs(Date.now() - started)} for ${op}${operand ? ` ${operand}` : ""} and it was there.`,
        selectorUsed: usedNow || selectorUsed,
        elapsed: Date.now() - started,
        cutShort: false,
      };
    }
    if (Date.now() >= until) {
      const saw = last === null ? "nothing there" : `"${clipText(last)}"`;
      const elapsed = Date.now() - started;
      return {
        met: false,
        note: cutShort()
          ? `The run ran out of time after ${secs(elapsed)} of a ${secs(limit)} wait for ${op}${operand ? ` ${operand}` : ""}; last saw ${saw}.`
          : `Waited ${secs(elapsed)} for ${op}${operand ? ` ${operand}` : ""}; last saw ${saw}.`,
        selectorUsed,
        elapsed,
        cutShort: cutShort(),
      };
    }
    await page.waitForTimeout(WAIT_POLL_MS);
  }
}

/** How long this wait may run, clamped to what a step is allowed to hold. */
export function waitLimit(step: SkillStep): number {
  return Math.min(Math.max(1000, step.waitMs ?? DEFAULT_WAIT_MS), MAX_WAIT_MS);
}

/** Whole seconds, for a note a person reads. */
function secs(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

/** A page's text, cut to something a step record can hold. */
function clipText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 120 ? t.slice(0, 120) + "…" : t;
}

