import { type Browser, type Locator, type Page } from "playwright";
import { launchBrowser } from "./browser";
import {
  decideEgress,
  followNavigation,
  routeWebSockets,
  runContextOptions,
  runLaunchOptions,
  sandboxPolicy,
} from "./sandbox";
import {
  attachRrwebCapture,
  saveRrwebEvents,
  type RrwebCapture,
} from "./rrweb-capture";
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
  setRunCommitment,
  setRunSandbox,
  setRunStatus,
} from "./runs";
import {
  registerLive,
  unregisterLive,
  waitForResume,
} from "./live";
import { buildCommitment, commitmentFields } from "./commitment";
import { resolveCredentials } from "./vault";
import { operatorChooseSelector } from "./operate";
import { collectCandidates } from "./dom";
import {
  assertSafeUrl,
  isUnsafeRequestUrl,
  hostInAllowlist,
  navHostResolvesPrivate,
} from "./safe-url";
import { runSlots } from "./semaphore";
import { attachReceipt } from "./receipt";
import { learnSelectors } from "./skills";
import { startChainedRun } from "./chain";
import { agenticStep, agentFallbackEnabled } from "./agent";
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
const LIVE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.AEMULUS_LIVE_TIMEOUT_MS) || 300_000,
); // how long an interactive checkpoint waits for a human
function liveHandoffEnabled(): boolean {
  return process.env.AEMULUS_LIVE_HANDOFF === "1";
}
// Sandbox guardrails for untrusted marketplace skills.
const RUN_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.AEMULUS_RUN_TIMEOUT_MS) || 120_000,
);
const STEP_TIMEOUT_MS = Math.max(
  3_000,
  Number(process.env.AEMULUS_STEP_TIMEOUT_MS) || 20_000,
);

// How many times a run will pause for a human to clear a captcha before giving
// up. Each pause opens the live view (like the 2FA handoff) so the person can
// solve the challenge; if it's still there after this many tries (or nobody
// shows up), the run parks in needs_review instead of looping forever.
const MAX_CAPTCHA_PAUSES = Math.max(
  0,
  Number(process.env.AEMULUS_CAPTCHA_MAX_PAUSES) || 3,
);

/** Heuristic: is the page currently showing a bot-challenge / captcha wall? Uses
 * visible markers (challenge iframes, Cloudflare interstitial, "unusual traffic"
 * text) so an ordinary reCAPTCHA checkbox on a form doesn't trip it. */
async function isCaptchaPresent(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const iframe = document.querySelector(
        'iframe[title*="recaptcha challenge" i], iframe[src*="hcaptcha.com/captcha"], iframe[title*="hcaptcha" i], iframe[src*="challenges.cloudflare.com"]',
      );
      const cf = document.querySelector("#challenge-running, #cf-challenge-running");
      const text = (document.body?.innerText || "").toLowerCase();
      const textHit =
        /unusual traffic|verify you are (a )?human|are you a robot|select all (images|squares)/.test(
          text,
        );
      return !!iframe || !!cf || textHit;
    });
  } catch {
    return false;
  }
}

export async function executeRun(
  skill: Skill,
  runId: string,
  owner: string,
  input: Record<string, string>,
  overrides: RunOverrides = {},
): Promise<Run> {
  await mkdir(path.join(RUNS_DIR, owner, runId), { recursive: true });

  let browser: Browser | null = null;
  let capture: RrwebCapture | null = null; // rrweb session events (if enabled)
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
    // Isolation boundary for this run: its own Chromium process with its own
    // profile (destroyed on close), the OS sandbox on, and the host-reaching
    // flags stripped. See lib/sandbox.ts.
    browser = await launchBrowser({
      headless: process.env.AEMULUS_RUN_HEADED !== "1",
      ...runLaunchOptions(),
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false, // a hostile page can't fill disk via downloads
      ...runContextOptions(), // no service workers: they can outlive a page and
      // issue requests the egress route below does not reliably see
    });
    // Best-effort rrweb capture for the rich replay (AEMULUS_RRWEB=1). Must be
    // wired before the first page is created; null + inert when disabled.
    capture = await attachRrwebCapture(context);
    // Egress guardrail: block requests to internal hosts / private IPs / unknown
    // schemes so an untrusted skill can't pull from the server's network. On top
    // of that, the per-skill allowlist is now enforced for every request that
    // could carry data OUT (fetch/xhr/websocket/beacon), not just navigations —
    // otherwise a published skill could scrape a page and POST the result to a
    // host it never declared. Passive resources (images, fonts, CSS) still load
    // from anywhere so ordinary pages render; see lib/sandbox.ts for the full
    // policy and its stated residual. Empty allowlist = unrestricted.
    const allowedHosts = skill.allowedHosts ?? [];
    const unrestricted = allowedHosts.length === 0;
    // Persist the boundary before the first step executes, so a run that dies
    // mid-flight still records what it was confined to. Best-effort: failing to
    // write the policy must never stop the run itself.
    await setRunSandbox(runId, JSON.stringify(sandboxPolicy(allowedHosts))).catch(
      (e) => logError("runner.sandbox-policy", e),
    );
    // Every check a URL must pass, in one place, so a redirect hop is held to
    // exactly the same standard as the request that started the navigation.
    const urlPasses = async (u: string, isNav: boolean, type: string) => {
      if (isUnsafeRequestUrl(u)) return false;
      // Block a hostname that RESOLVES private (the sync filter above only
      // catches literal private IPs) for EVERY request, not just navigations -
      // a subresource to a public host whose DNS points inside the network would
      // otherwise reach internal services. Host-cached (60s) so it's one lookup
      // per distinct host.
      if (await navHostResolvesPrivate(u)) return false;
      return (
        decideEgress({
          resourceType: type,
          isNavigation: isNav,
          hostAllowed: hostInAllowlist(u, allowedHosts),
          unrestricted,
        }) === "allow"
      );
    };
    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      const isNav = req.isNavigationRequest();
      const type = req.resourceType();
      if (!(await urlPasses(url, isNav, type))) return route.abort();
      // A navigation that gets a 3xx would otherwise be followed by the network
      // stack WITHOUT coming back through this handler, which walks straight past
      // both the allowlist and the SSRF guard. Follow it hop by hop instead,
      // re-checking each Location. Subresource redirects stay on the fast path:
      // their responses aren't readable cross-origin, so the same abuse doesn't
      // land, and routing every image through fetch/fulfill would be costly.
      if (isNav) {
        return followNavigation(route, url, (next) => urlPasses(next, true, type));
      }
      return route.continue();
    });
    // WebSockets bypass context.route() entirely, so the rule above is blind to
    // them. Without this a skill confined to one host could still open a socket
    // anywhere and stream out everything it read.
    await routeWebSockets(context, allowedHosts, hostInAllowlist);
    const page = await context.newPage();
    // Close any popup/extra tab the run didn't open (the runner only drives the
    // original page) so a window.open() storm can't leak Page objects.
    context.on("page", (p) => {
      if (p !== page) void p.close().catch(() => {});
    });
    page.setDefaultTimeout(STEP_TIMEOUT_MS); // per-action cap (no hanging steps)
    let deadline = Date.now() + RUN_TIMEOUT_MS; // hard wall-clock cap (extended over human pauses)
    let captchaPauses = 0; // how many times we've paused for a human to clear a captcha

    // Credential vault: auto-fill the runner's stored secrets into matching input
    // fields not already provided (explicit input wins). ONLY for a skill the
    // runner AUTHORED (owner === runner): a marketplace skill written by someone
    // else controls the field keys, selectors, and plan, so it could declare an
    // input keyed "password", allowlist a host the runner has a credential for, and
    // steer that credential into an author-readable element on the SAME host — which
    // host-binding alone can't stop. Auto-fill is therefore your-own-skills-only;
    // running another author's skill never pulls your vault. Each secret is still
    // bound to vaultHost and only typed while the page is on that host (per-step
    // check below).
    let effInput = input;
    const vaultKeys = new Set<string>();
    const vaultHost = allowedHosts[0]?.toLowerCase() ?? "";
    // Input fields the author marked secret (masked in all UI) — used, together
    // with vaultKeys, to keep a typed secret out of step records + screenshots.
    const secretFieldKeys = new Set(
      skill.inputSchema.fields.filter((f) => f.secret).map((f) => f.key),
    );
    try {
      if (vaultHost && owner === skill.owner) {
        const creds = await resolveCredentials(owner, vaultHost);
        const fieldKeys = new Set(skill.inputSchema.fields.map((f) => f.key));
        const fill: Record<string, string> = {};
        for (const [k, v] of Object.entries(creds)) {
          // `!v` skips an undecryptable entry (rotated AUTH_SECRET → "") so a blank
          // credential is never typed/submitted (fail safe, not fail blank).
          if (fieldKeys.has(k) && !input[k] && v) {
            fill[k] = v;
            vaultKeys.add(k);
          }
        }
        if (Object.keys(fill).length) effInput = { ...fill, ...input };
      }
    } catch (e) {
      logError("runner.vault", e);
    }

    for (const step of skill.plan) {
      if (Date.now() > deadline) {
        finalStatus = "failed";
        error = "Run exceeded the time limit.";
        break;
      }

      // Bot-wall handling: if a captcha is blocking the page, open the live view
      // and let a human solve it (stealth makes it solvable), then re-check and
      // continue. After MAX_CAPTCHA_PAUSES — or if nobody solves it in time — the
      // run parks in needs_review rather than looping "try again" forever.
      let captchaBlocked = false;
      while (await isCaptchaPresent(page)) {
        if (captchaPauses >= MAX_CAPTCHA_PAUSES) {
          captchaBlocked = true;
          break;
        }
        captchaPauses += 1;
        await setRunStatus(runId, "awaiting_input");
        const pauseStart = Date.now();
        await registerLive(runId, page);
        let outcome: "resumed" | "timeout";
        try {
          outcome = await waitForResume(runId, LIVE_TIMEOUT_MS);
        } finally {
          await unregisterLive(runId);
        }
        deadline += Date.now() - pauseStart; // don't bill the human pause to the run
        if (outcome === "timeout") {
          captchaBlocked = true;
          break;
        }
        await setRunStatus(runId, "running");
      }
      if (captchaBlocked) {
        finalStatus = "needs_review";
        error = "Blocked by a captcha the run couldn't get past.";
        break;
      }

      const value = resolveValue(step, effInput);
      const override = overrides[step.idx];
      const shotFile = `step-${String(step.idx).padStart(4, "0")}.png`;
      const shotRel = path.posix.join("recordings", owner, runId, shotFile);
      const shotPath = path.join(RUNS_DIR, owner, runId, shotFile);

      // A step that types a secret (a vault-filled or author-marked-secret input).
      // Its value must never be persisted in the step record (shown unmasked in the
      // Steps list + replay), and its post-fill screenshot must not be captured (a
      // token in a non-password field would be stored in cleartext on disk + folded
      // into the receipt). `recVal`/`recShot` are the redacted values to record.
      const sensitive =
        (step.action === "input" || step.action === "select") &&
        step.valueSource === "input" &&
        (vaultKeys.has(step.inputKey) || secretFieldKeys.has(step.inputKey));
      const recVal = sensitive ? "" : value;
      const recShot = sensitive ? "" : shotRel;
      const snap = async () => {
        if (!sensitive) await page.screenshot({ path: shotPath }).catch(() => {});
      };

      try {
        // Reviewer chose to skip this step.
        if (override?.skip) {
          await snap();
          await recordStep(runId, step, "", recVal, recShot, 1, false, "Skipped by reviewer.");
          continue;
        }

        // Conditional step (branching): run only if the condition holds. Use the
        // redacted recVal/recShot + snap() like every other secret-typing path — a
        // conditional SECRET input whose condition is false must not persist the
        // resolved credential into the step record (shown unmasked + folded into the
        // receipt).
        if (step.condition && !(await conditionMet(page, step.condition))) {
          await snap();
          await recordStep(
            runId,
            step,
            "",
            recVal,
            recShot,
            1,
            false,
            `Skipped: condition (${step.condition.kind} ${step.condition.selector}) not met.`,
          );
          continue;
        }

        // Interactive checkpoint: pause for a live human takeover (e.g. 2FA),
        // keeping THIS browser/context alive so the authenticated session
        // persists, then resume. Opt-in via AEMULUS_LIVE_HANDOFF=1.
        // NOTE: the run holds its Chromium run-slot for the whole pause — by
        // design, since the browser stays allocated (releasing the slot would let
        // total live browsers exceed AEMULUS_MAX_CONCURRENT_RUNS). It's bounded by
        // LIVE_TIMEOUT_MS and off by default; many concurrent handoffs can still
        // starve the pool, so size the pool for expected interactive concurrency.
        if (step.interactive && liveHandoffEnabled()) {
          await setRunStatus(runId, "awaiting_input");
          const pauseStart = Date.now();
          let outcome: "resumed" | "timeout";
          // finally so the LiveSession (Page + CDP + screencast) is always torn
          // down even if an await between register and unregister ever throws.
          await registerLive(runId, page);
          try {
            outcome = await waitForResume(runId, LIVE_TIMEOUT_MS);
          } finally {
            await unregisterLive(runId);
          }
          deadline += Date.now() - pauseStart; // don't bill the human pause to the run
          await snap();
          if (outcome === "timeout") {
            await recordStep(runId, step, "", recVal, recShot, 1, true, "Timed out waiting for the live takeover.");
            finalStatus = "needs_review";
            break;
          }
          await setRunStatus(runId, "running");
          await recordStep(runId, step, "", recVal, recShot, 1, false, "Human completed an interactive checkpoint.");
          continue;
        }

        // Skill chaining: start a child run of another skill (composition).
        if (step.action === "run_skill") {
          const res = await startChainedRun({
            parentSkillId: skill.id,
            subSkillId: step.subSkillId ?? "",
            owner,
            parentInput: effInput,
            parentOutputs: outputs,
          });
          await page.screenshot({ path: shotPath }).catch(() => {});
          const chainNote =
            "runId" in res
              ? `Chained skill -> run ${res.runId}`
              : `Chain skipped: ${res.skipped}`;
          await recordStep(runId, step, "", "", shotRel, DETERMINISTIC_CONFIDENCE, false, chainNote);
          continue;
        }

        if (step.action === "navigate") {
          await assertSafeUrl(step.target); // SSRF guard before any navigation
          if (!hostInAllowlist(step.target, allowedHosts)) {
            throw new Error(`Navigation to ${step.target} is not in the skill's allowed hosts.`);
          }
          await page.goto(step.target, { waitUntil: "domcontentloaded" });
          // Give SPA / lazily-rendered content a chance to settle before the
          // next step looks for its element. Bounded so a long-polling page
          // (never "idle") can't stall the run.
          await page
            .waitForLoadState("networkidle", { timeout: 5_000 })
            .catch(() => {});
          await page.screenshot({ path: shotPath });
          await recordStep(runId, step, "", value, shotRel, DETERMINISTIC_CONFIDENCE, false, "");
          continue;
        }

        // Host-bind vault secrets: only type an auto-filled credential while the
        // browser is actually on the credential's host. Without this a skill
        // could navigate to another (also-allowed) host and capture the secret.
        if (
          // input + select are the actions that actually apply the resolved
          // value to the page, so a vault secret could land there off-host.
          (step.action === "input" || step.action === "select") &&
          step.valueSource === "input" &&
          vaultKeys.has(step.inputKey) &&
          !hostMatches(page.url(), vaultHost)
        ) {
          await page.screenshot({ path: shotPath }).catch(() => {});
          await recordStep(
            runId,
            step,
            "",
            "",
            shotRel,
            1,
            true,
            "Vault credential withheld: the page host does not match the credential host.",
          );
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

        // A dead selector triggers slow model calls (operator + up to 5 agentic
        // steps, each ~60s). Bail before them if we're already past the deadline
        // so one stuck step can't blow the overall RUN_TIMEOUT by minutes (the
        // loop-top check only fires BETWEEN steps).
        if (!loc && Date.now() > deadline) {
          finalStatus = "failed";
          error = "Run exceeded the time limit.";
          await snap();
          await recordStep(runId, step, "", recVal, recShot, 0, true, "Skipped: run time limit reached.");
          break;
        }

        if (!loc) {
          const decision = await tryOperator(page, step);
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
          // Agentic fallback (opt-in): before pausing for a human, let the agent
          // try to accomplish the step itself. Only for action steps (extract is
          // a read, not something the agent performs).
          if (agentFallbackEnabled() && step.action !== "extract" && Date.now() <= deadline) {
            // Hide the value from the model for BOTH a vault credential and an
            // author-marked secret input (mirrors the step-record masking at line
            // 195) — otherwise a non-owner's secret would be echoed into the operator
            // prompt. Only a vault credential is additionally host-bound, so pass
            // vaultHost ONLY for vault keys (an author secret has no host to bind to
            // and must not be refused off-host).
            const isSecretInput =
              (step.action === "input" || step.action === "select") &&
              step.valueSource === "input" &&
              (vaultKeys.has(step.inputKey) || secretFieldKeys.has(step.inputKey));
            const ag = await agenticStep(page, step, value, {
              sensitive: isSecretInput,
              vaultHost: vaultKeys.has(step.inputKey) ? vaultHost : undefined,
              deadline,
            });
            tokensIn += ag.tokensIn;
            tokensOut += ag.tokensOut;
            if (ag.ok) {
              await snap();
              await recordStep(runId, step, ag.selectorUsed, recVal, recShot, ag.confidence, false, ag.note);
              continue; // the agent performed the step
            }
            note = ag.note || note;
          }
          await snap();
          await recordStep(
            runId,
            step,
            selectorUsed,
            recVal,
            recShot,
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
          // If something is already sitting on top, don't spend the full step
          // timeout discovering that. Nothing upstream catches this case: the
          // element was found, so locate() succeeded and the operator was never
          // consulted; the failure only shows up here, as a click that never
          // lands.
          const covered =
            step.action === "click" && (await isCovered(loc.locator));
          try {
            await perform(
              page,
              loc.locator,
              step,
              value,
              covered ? COVERED_CLICK_MS : undefined,
            );
          } catch (performErr) {
            // The element was located fine, so this is not a "can't find it"
            // problem — something is in the way. That is exactly the situation
            // the agent can reason about (a consent wall, a modal, a sticky
            // banner) and a retry loop cannot. Anything that is NOT an
            // obstruction rethrows and fails the step as before.
            const canAsk =
              isBlockedError(performErr) &&
              agentFallbackEnabled() &&
              Date.now() <= deadline;
            if (!canAsk) throw performErr;
            const isSecretInput =
              (step.action === "input" || step.action === "select") &&
              step.valueSource === "input" &&
              (vaultKeys.has(step.inputKey) || secretFieldKeys.has(step.inputKey));
            const ag = await agenticStep(page, step, value, {
              sensitive: isSecretInput,
              vaultHost: vaultKeys.has(step.inputKey) ? vaultHost : undefined,
              deadline,
            });
            tokensIn += ag.tokensIn;
            tokensOut += ag.tokensOut;
            // Rethrow the ORIGINAL error, not the agent's: "X intercepts
            // pointer events" tells you what actually went wrong, where "the
            // agent gave up" does not.
            if (!ag.ok) throw performErr;
            await snap();
            await recordStep(
              runId,
              step,
              ag.selectorUsed,
              recVal,
              recShot,
              ag.confidence,
              false,
              ag.note || "Something was covering the element; the agent cleared it.",
            );
            continue;
          }
          await page.waitForTimeout(150);
          await snap(); // skips the screenshot for a secret-typing step
          await recordStep(runId, step, selectorUsed, recVal, recShot, confidence, false, note);
        }
      } catch (stepErr) {
        await snap();
        await recordStep(
          runId,
          step,
          "",
          recVal,
          recShot,
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
    // This only fires for an INFRASTRUCTURE failure (e.g. the browser couldn't
    // launch) — step-level errors are caught inside the loop and settle the run
    // as failed/needs_review normally. Rethrow so completeRun propagates it and
    // the job worker retries with backoff (per the worker contract). The finally
    // below still runs (closes the browser + releases the slot) before it does.
    throw err instanceof Error ? err : new Error("Run failed to start.");
  } finally {
    // Closing the browser also destroys the run's profile directory, which
    // Playwright created for this launch alone.
    await browser?.close().catch(() => {});
    // Persist the rrweb events (best-effort) for the replay - even for failed
    // runs, where the replay is most useful for debugging.
    if (capture) await saveRrwebEvents(RUNS_DIR, owner, runId, capture.events);
    runSlots.release();
  }

  const result =
    finalStatus === "completed"
      ? `Completed ${skill.plan.length} steps.`
      : null;
  // Persist the terminal status resiliently. A transient DB error here must NOT
  // leave the run "running" — the job would retry and re-execute the entire
  // browser run, double-firing real side effects against the target site.
  for (let attempt = 0; ; attempt++) {
    try {
      await finishRun(runId, { status: finalStatus, result, error });
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  // Output + receipt are best-effort: a failure here must NOT throw out of
  // executeRun, or completeRun's catch would wrongly re-mark a completed run as
  // failed. The finalized status above is the source of truth.
  try {
    await setRunOutput(runId, outputs); // structured data from extract steps
    // Private verifiable receipt: a hiding commitment over the run's fields,
    // built BEFORE the receipt so its root is folded into the anchored digest.
    try {
      const r = await getRun(runId);
      if (r) {
        const c = buildCommitment(commitmentFields(r));
        await setRunCommitment(runId, c.root, c.salts);
      }
    } catch (e) {
      logError("runner.commitment", e);
    }
    // Vision success-verification: did the final screen show the goal was met?
    // Best-effort (skips silently without an API key); its tokens roll into the
    // run's cost below. Run this BEFORE attachReceipt so the outcome verdict is
    // folded into the receipt hash (and thus the on-chain anchor) — otherwise the
    // hash would omit the very "achieved" signal it's meant to make tamper-evident.
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

    await attachReceipt(runId); // verifiable receipt (+ anchor if configured)

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
  // Prefer a VISIBLE match (a selector can match a hidden/duplicate node while
  // the real, actionable one is visible). Fall back to the first element that
  // merely exists, preserving the old behavior when nothing is visible yet.
  let fallback: { locator: Locator; selector: string } | null = null;
  for (const sel of selectors) {
    if (!sel) continue;
    try {
      const locator = page.locator(sel).first();
      if ((await locator.count()) === 0) continue;
      if (!fallback) fallback = { locator, selector: sel };
      if (await locator.isVisible()) return { locator, selector: sel };
    } catch {
      // invalid selector - skip
    }
  }
  return fallback;
}

/** True if `url`'s host equals `host` or is a subdomain of it. */
function hostMatches(url: string, host: string): boolean {
  if (!host) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === host || h.endsWith(`.${host}`);
  } catch {
    return false; // about:blank / no host
  }
}

// Cap a single captured value so a hostile page with a multi-megabyte text node
// can't bloat the (encrypted) run output / commitment / memory.
const MAX_CAPTURE_CHARS = 20_000;

/** Read a value off an element: form value for inputs, else visible text. */
async function captureValue(loc: Locator): Promise<string> {
  let raw = "";
  try {
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "input" || tag === "textarea" || tag === "select") {
      raw = (await loc.inputValue()).trim();
    } else {
      raw = ((await loc.textContent()) ?? "").trim();
    }
  } catch {
    raw = ((await loc.textContent()) ?? "").trim();
  }
  return raw.slice(0, MAX_CAPTURE_CHARS);
}

/**
 * How long to keep trying a click we already know is covered.
 *
 * Playwright's default actionability wait is the full step timeout (20s). When
 * an overlay is sitting on the element that wait is almost always wasted — the
 * dialog is not going to dismiss itself — and the run dies having burned the
 * time. Once isCovered() says something is on top, a couple of seconds is
 * plenty for a transient banner to finish animating out; beyond that the agent
 * is a better answer than more waiting.
 */
const COVERED_CLICK_MS = 2_500;

/**
 * Is another element sitting over this one's click point?
 *
 * This is the condition Playwright reports as "<el> intercepts pointer events"
 * — the element is found, visible, and enabled, so nothing upstream treats it
 * as a failure, and then every click silently lands on whatever is on top.
 * Cookie-consent walls are the common case: a real one cost a run 20 seconds
 * and then failed it outright.
 *
 * Deliberately conservative. Returns false on any error, and false when the top
 * element is related to the target (a label wrapping its input, an icon inside
 * a button), because those receive the click on the target's behalf and are not
 * obstructions.
 */
export async function isCovered(loc: Locator): Promise<boolean> {
  try {
    return await loc.evaluate(
      (el) => {
        const r = (el as Element).getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const top = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        if (!top || top === el) return false;
        return !el.contains(top) && !top.contains(el);
      },
      undefined,
      // evaluate() auto-waits for the element, so without an explicit timeout a
      // node that vanished between locate() and here would stall for the whole
      // step timeout — reintroducing the 20-second hang this function exists to
      // remove. A check this cheap either answers immediately or is not worth
      // waiting for. Caught by a test.
      { timeout: 1_000 },
    );
  } catch {
    return false;
  }
}

/** Does this failure mean "something was in the way", rather than "not found"? */
export function isBlockedError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? "");
  return (
    m.includes("intercepts pointer events") ||
    // Playwright reports the give-up as a plain timeout; pair it with the
    // actionability line so an unrelated navigation timeout isn't swept in.
    (m.includes("Timeout") && m.includes("waiting for element to be visible"))
  );
}

async function perform(
  page: Page,
  loc: Locator,
  step: SkillStep,
  value: string,
  clickTimeoutMs?: number,
): Promise<void> {
  switch (step.action) {
    case "click":
      await loc.click(clickTimeoutMs ? { timeout: clickTimeoutMs } : {});
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

async function tryOperator(page: Page, step: SkillStep) {
  try {
    const candidates = await collectCandidates(page);
    const shot = await page.screenshot({ type: "png" });
    return await operatorChooseSelector({
      intent: step.intent,
      action: step.action,
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
