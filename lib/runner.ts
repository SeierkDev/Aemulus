import { chromium, type Browser, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { id } from "./ids";
import { createRun, addRunStep, finishRun, getRun } from "./runs";
import { operatorChooseSelector, type Candidate } from "./operate";
import { assertSafeUrl } from "./safe-url";
import { runSlots } from "./semaphore";
import type { Run, RunOverrides, RunStatus, Skill, SkillStep } from "./types";

/**
 * Execute a skill against a set of inputs.
 *
 * Strategy: replay each step deterministically using the recorded selectors
 * (cheap, reliable, no LLM). When a selector no longer resolves, fall back to
 * the operator (Claude vision) to pick the right element with a confidence.
 * If confidence is below the floor — or the operator (or its API key) is
 * unavailable — flag the step and pause the run for a human (needs_review).
 */

const RUNS_DIR = path.join(process.cwd(), ".data", "recordings");
const CONFIDENCE_FLOOR = 0.6;
const DETERMINISTIC_CONFIDENCE = 0.99;

export async function executeRun(
  skill: Skill,
  input: Record<string, string>,
  overrides: RunOverrides = {},
  owner = "",
): Promise<Run> {
  const run = await createRun({ owner, skillId: skill.id, input, overrides });
  await mkdir(path.join(RUNS_DIR, owner, run.id), { recursive: true });

  let browser: Browser | null = null;
  let finalStatus: RunStatus = "completed";
  let error: string | null = null;

  // Bound concurrent Chromium launches; excess runs queue here.
  await runSlots.acquire();
  try {
    browser = await chromium.launch({
      headless: process.env.AEMULUS_RUN_HEADED !== "1",
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    for (const step of skill.plan) {
      const value = resolveValue(step, input);
      const override = overrides[step.idx];
      const shotFile = `step-${String(step.idx).padStart(4, "0")}.png`;
      const shotRel = path.posix.join("recordings", owner, run.id, shotFile);
      const shotPath = path.join(RUNS_DIR, owner, run.id, shotFile);

      try {
        // Reviewer chose to skip this step.
        if (override?.skip) {
          await page.screenshot({ path: shotPath }).catch(() => {});
          await recordStep(run.id, step, "", value, shotRel, 1, false, "Skipped by reviewer.");
          continue;
        }

        if (step.action === "navigate") {
          await assertSafeUrl(step.target); // SSRF guard before any navigation
          await page.goto(step.target, { waitUntil: "domcontentloaded" });
          await page.screenshot({ path: shotPath });
          await recordStep(run.id, step, "", value, shotRel, DETERMINISTIC_CONFIDENCE, false, "");
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
          confidence = decision.confidence;
          note = decision.reasoning;
          if (decision.selector && decision.confidence >= CONFIDENCE_FLOOR) {
            loc = await locate(page, [decision.selector]);
            selectorUsed = loc?.selector ?? "";
          }
        }

        if (!loc || confidence < CONFIDENCE_FLOOR) {
          await page.screenshot({ path: shotPath });
          await recordStep(
            run.id,
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

        await perform(page, loc.locator, step, value);
        await page.waitForTimeout(150);
        await page.screenshot({ path: shotPath });
        await recordStep(run.id, step, selectorUsed, value, shotRel, confidence, false, note);
      } catch (stepErr) {
        await page.screenshot({ path: shotPath }).catch(() => {});
        await recordStep(
          run.id,
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
  await finishRun(run.id, { status: finalStatus, result, error });
  return (await getRun(run.id))!;
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
      // invalid selector — skip
    }
  }
  return null;
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
