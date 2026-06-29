import { chromium, type Browser, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { id } from "./ids";
import {
  addRunStep,
  finishRun,
  getRun,
  setRunOutput,
  setRunOutcome,
  setRunUsage,
} from "./runs";
import { operatorChooseSelector, type Candidate } from "./operate";
import { assertSafeUrl, isUnsafeRequestUrl, hostInAllowlist } from "./safe-url";
import { runSlots } from "./semaphore";
import { attachReceipt } from "./receipt";
import { learnSelectors } from "./skills";
import { verifyOutcome } from "./verify-outcome";
import { incr } from "./metrics";
import { logError, logInfo } from "./log";
import type { Run, RunOverrides, RunStatus, Skill, SkillStep } from "./types";

/**
 * Execute a skill against an ALREADY-CREATED run row (status "running").
 * The run-service creates the row and returns immediately; this does the work
 * in the background.
 *
 * Strategy: replay each step deterministically using the recorded selectors
 * (cheap, reliable, no LLM). When a selector no longer resolves, fall back to
 * the operator (Claude vision) to pick the right element with a confidence.
 * If confidence is below the floor - or the operator (or its API key) is
 * unavailable - flag the step and pause the run for a human (needs_review).
 */

const RUNS_DIR = path.join(process.cwd(), ".data", "recordings");
const CONFIDENCE_FLOOR = 0.6;
const DETERMINISTIC_CONFIDENCE = 0.99;
const LOOP_MAX = Math.max(1, Number(process.env.AEMULUS_LOOP_MAX) || 500); // cap per-loop captures
// Sandbox guardrails for untrusted marketplace skills.
const RUN_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.AEMULUS_RUN_TIMEOUT_MS) || 120_000,
);
const STEP_TIMEOUT_MS = Math.max(
  3_000,
  Number(process.env.AEMULUS_STEP_TIMEOUT_MS) || 20_000,
);

export async function executeRun(
  skill: Skill,
  runId: string,
  owner: string,
  input: Record<string, string>,
  overrides: RunOverrides = {},
): Promise<Run> {
  await mkdir(path.join(RUNS_DIR, owner, runId), { recursive: true });

  let browser: Browser | null = null;
  let finalStatus: RunStatus = "completed";
  let error: string | null = null;
  const outputs: Record<string, string> = {}; // values captured by extract steps
  const healed: Record<number, string> = {}; // step idx → operator-found selector
  let finalShot: string | null = null; // final screen (base64) for outcome check
  let tokensIn = 0; // operator (Claude) tokens spent this run
  let tokensOut = 0;

  // Bound concurrent Chromium launches; excess runs queue here.
  await runSlots.acquire();
  try {
    browser = await chromium.launch({
      headless: process.env.AEMULUS_RUN_HEADED !== "1",
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    // Egress guardrail: block requests to internal hosts / private IPs / unknown
    // schemes so an untrusted skill can't pull from the server's network. Plus
    // the per-skill allowlist - NAVIGATIONS must target a declared host (so a
    // published skill can't be edited to quietly exfiltrate to a new domain);
    // subresources still load so pages render. Empty allowlist = unrestricted.
    const allowedHosts = skill.allowedHosts ?? [];
    await context.route("**/*", (route) => {
      const req = route.request();
      const url = req.url();
      if (isUnsafeRequestUrl(url)) return route.abort();
      if (req.isNavigationRequest() && !hostInAllowlist(url, allowedHosts)) {
        return route.abort();
      }
      route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS); // per-action cap (no hanging steps)
    const deadline = Date.now() + RUN_TIMEOUT_MS; // hard wall-clock cap

    for (const step of skill.plan) {
      if (Date.now() > deadline) {
        finalStatus = "failed";
        error = "Run exceeded the time limit.";
        break;
      }
      const value = resolveValue(step, input);
      const override = overrides[step.idx];
      const shotFile = `step-${String(step.idx).padStart(4, "0")}.png`;
      const shotRel = path.posix.join("recordings", owner, runId, shotFile);
      const shotPath = path.join(RUNS_DIR, owner, runId, shotFile);

      try {
        // Reviewer chose to skip this step.
        if (override?.skip) {
          await page.screenshot({ path: shotPath }).catch(() => {});
          await recordStep(runId, step, "", value, shotRel, 1, false, "Skipped by reviewer.");
          continue;
        }

        // Conditional step (branching): run only if the condition holds.
        if (step.condition && !(await conditionMet(page, step.condition))) {
          await page.screenshot({ path: shotPath }).catch(() => {});
          await recordStep(
            runId,
            step,
            "",
            value,
            shotRel,
            1,
            false,
            `Skipped: condition (${step.condition.kind} ${step.condition.selector}) not met.`,
          );
          continue;
        }

        if (step.action === "navigate") {
          await assertSafeUrl(step.target); // SSRF guard before any navigation
          if (!hostInAllowlist(step.target, allowedHosts)) {
            throw new Error(`Navigation to ${step.target} is not in the skill's allowed hosts.`);
          }
          await page.goto(step.target, { waitUntil: "domcontentloaded" });
          await page.screenshot({ path: shotPath });
          await recordStep(runId, step, "", value, shotRel, DETERMINISTIC_CONFIDENCE, false, "");
          continue;
        }

        // Resolve a locator: reviewer's corrected selector first (if any),
        // then recorded selectors, then operator fallback.
        const selectors = override?.selector
          ? [override.selector, ...step.selectors]
          : step.selectors;
        let loc = await locate(page, selectors);
        let selectorUsed = loc?.selector ?? "";
        let confidence = DETERMINISTIC_CONFIDENCE;
        let note = "";

        if (!loc) {
          const decision = await tryOperator(page, step, value);
          tokensIn += decision.tokensIn;
          tokensOut += decision.tokensOut;
          confidence = decision.confidence;
          note = decision.reasoning;
          if (decision.selector && decision.confidence >= CONFIDENCE_FLOOR) {
            loc = await locate(page, [decision.selector]);
            selectorUsed = loc?.selector ?? "";
            // Self-healing: the operator found a working selector the recorded
            // ones missed. Remember it; if the whole run completes, we write it
            // back into the skill so next time is deterministic (no operator).
            if (loc) healed[step.idx] = selectorUsed;
          }
        }

        if (!loc || confidence < CONFIDENCE_FLOOR) {
          await page.screenshot({ path: shotPath });
          await recordStep(
            runId,
            step,
            selectorUsed,
            value,
            shotRel,
            confidence,
            true,
            note || "Could not confidently locate the element.",
          );
          finalStatus = "needs_review";
          break;
        }

        if (step.action === "extract") {
          const key = step.outputKey || `value_${step.idx}`;
          if (step.loop) {
            // In-skill loop: capture EVERY element matching the selector (e.g.
            // every row/price in a list) into a JSON array, not just the first.
            const els = page.locator(selectorUsed);
            const total = Math.min(await els.count(), LOOP_MAX);
            const values: string[] = [];
            for (let k = 0; k < total; k++) {
              values.push(await captureValue(els.nth(k)));
            }
            outputs[key] = JSON.stringify(values);
            await page.screenshot({ path: shotPath });
            await recordStep(runId, step, selectorUsed, `${values.length} items`, shotRel, confidence, false, `Captured ${values.length} values into ${key}.`);
          } else {
            // Read a single value off the page into the run's structured output.
            const captured = await captureValue(loc.locator);
            outputs[key] = captured;
            await page.screenshot({ path: shotPath });
            await recordStep(runId, step, selectorUsed, captured, shotRel, confidence, false, `Captured ${key} = "${captured}"`);
          }
        } else {
          await perform(page, loc.locator, step, value);
          await page.waitForTimeout(150);
          await page.screenshot({ path: shotPath });
          await recordStep(runId, step, selectorUsed, value, shotRel, confidence, false, note);
        }
      } catch (stepErr) {
        await page.screenshot({ path: shotPath }).catch(() => {});
        await recordStep(
          runId,
          step,
          "",
          value,
          shotRel,
          0,
          true,
          stepErr instanceof Error ? stepErr.message : "Step failed.",
        );
        finalStatus = "failed";
        error = stepErr instanceof Error ? stepErr.message : "Step failed.";
        break;
      }
    }
    // Capture the final screen for outcome verification (before the browser closes).
    if (finalStatus === "completed") {
      finalShot = await page
        .screenshot()
        .then((b) => b.toString("base64"))
        .catch(() => null);
    }
  } catch (err) {
    finalStatus = "failed";
    error = err instanceof Error ? err.message : "Run failed to start.";
  } finally {
    await browser?.close().catch(() => {});
    runSlots.release();
  }

  const result =
    finalStatus === "completed"
      ? `Completed ${skill.plan.length} steps.`
      : null;
  await finishRun(runId, { status: finalStatus, result, error });
  // Output + receipt are best-effort: a failure here must NOT throw out of
  // executeRun, or completeRun's catch would wrongly re-mark a completed run as
  // failed. The finalized status above is the source of truth.
  try {
    await setRunOutput(runId, outputs); // structured data from extract steps
    await attachReceipt(runId); // verifiable receipt (+ anchor if configured)

    // Vision success-verification: did the final screen show the goal was met?
    // Best-effort (skips silently without an API key); its tokens roll into the
    // run's cost below.
    if (finalStatus === "completed" && finalShot) {
      const goal = `${skill.name}. ${skill.description}`.trim();
      const v = await verifyOutcome(goal, finalShot);
      if (v) {
        tokensIn += v.tokensIn;
        tokensOut += v.tokensOut;
        const status = v.achieved ? "achieved" : "unconfirmed";
        await setRunOutcome(runId, status, v.reason);
        incr(v.achieved ? "runs.outcomeVerified" : "runs.outcomeUnconfirmed");
      }
    }

    // Self-healing: only on a fully-completed run, and only when the owner runs
    // their own skill (never let a third party's run mutate a published skill).
    if (
      finalStatus === "completed" &&
      owner === skill.owner &&
      Object.keys(healed).length > 0
    ) {
      const n = await learnSelectors(skill.id, healed);
      if (n > 0) {
        incr("skills.selfHealed", n);
        logInfo("runner.selfHeal", `healed ${n} selector(s)`, { skill: skill.id });
      }
    }

    await setRunUsage(runId, tokensIn, tokensOut); // cost transparency (incl. verify)
  } catch (e) {
    logError("runner.finalize", e);
  }
  return (await getRun(runId))!;
}

/** Evaluate a step's branch condition against the current page. */
async function conditionMet(
  page: Page,
  cond: { kind: "exists" | "absent"; selector: string },
): Promise<boolean> {
  let present = false;
  try {
    present = (await page.locator(cond.selector).count()) > 0;
  } catch {
    present = false; // invalid selector → treat as not present
  }
  return cond.kind === "exists" ? present : !present;
}

function resolveValue(step: SkillStep, input: Record<string, string>): string {
  if (step.valueSource === "input") return input[step.inputKey] ?? "";
  if (step.valueSource === "constant") return step.value;
  return "";
}

async function locate(
  page: Page,
  selectors: string[],
): Promise<{ locator: Locator; selector: string } | null> {
  for (const sel of selectors) {
    if (!sel) continue;
    try {
      const locator = page.locator(sel).first();
      if ((await locator.count()) > 0) return { locator, selector: sel };
    } catch {
      // invalid selector - skip
    }
  }
  return null;
}

/** Read a value off an element: form value for inputs, else visible text. */
async function captureValue(loc: Locator): Promise<string> {
  try {
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return (await loc.inputValue()).trim();
    }
  } catch {
    /* fall through to text */
  }
  return ((await loc.textContent()) ?? "").trim();
}

async function perform(
  page: Page,
  loc: Locator,
  step: SkillStep,
  value: string,
): Promise<void> {
  switch (step.action) {
    case "click":
      await loc.click();
      break;
    case "input":
      await loc.fill(value);
      break;
    case "select":
      await loc.selectOption(value);
      break;
    case "key":
      await loc.press(step.key || "Enter");
      break;
    case "submit":
      await loc.press("Enter");
      break;
  }
}

async function tryOperator(page: Page, step: SkillStep, value: string) {
  try {
    const candidates = await collectCandidates(page);
    const shot = await page.screenshot({ type: "png" });
    return await operatorChooseSelector({
      intent: step.intent,
      action: step.action,
      value,
      candidates,
      screenshotBase64: shot.toString("base64"),
    });
  } catch (err) {
    return {
      selector: "",
      confidence: 0,
      reasoning:
        err instanceof Error
          ? `Operator unavailable: ${err.message}`
          : "Operator unavailable.",
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}

/** Snapshot the page's interactive elements for the operator to choose from. */
function collectCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    const esc = (s: string) =>
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(s)
        : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const sel = (el: Element): string => {
      const id = el.getAttribute("id");
      if (id) return `#${esc(id)}`;
      const tag = el.tagName.toLowerCase();
      const name = el.getAttribute("name");
      if (name) return `${tag}[name="${name}"]`;
      const aria = el.getAttribute("aria-label");
      if (aria) return `${tag}[aria-label="${aria}"]`;
      return tag;
    };
    const nodes = Array.from(
      document.querySelectorAll(
        "a, button, input, select, textarea, [role='button'], [onclick]",
      ),
    ).slice(0, 50);
    return nodes.map((el) => ({
      selector: sel(el),
      tag: el.tagName.toLowerCase(),
      name:
        el.getAttribute("aria-label") ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        "",
      text: ((el as HTMLElement).innerText || "").trim().slice(0, 60),
    }));
  });
}

async function recordStep(
  runId: string,
  step: SkillStep,
  selectorUsed: string,
  value: string,
  screenshot: string,
  confidence: number,
  flagged: boolean,
  note: string,
): Promise<void> {
  await addRunStep({
    id: id("rst"),
    runId,
    idx: step.idx,
    intent: step.intent,
    action: step.action,
    selectorUsed,
    value,
    screenshot,
    confidence,
    flagged,
    note,
    createdAt: Date.now(),
  });
}
