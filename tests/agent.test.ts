import { describe, expect, it, afterEach } from "vitest";
import { agentFallbackEnabled } from "../lib/agent";
import { readFileSync } from "node:fs";

/**
 * The fallback shipped opt-in, and the opt-in was the whole problem.
 *
 * A stuck step paused for a human. On your own run that is fine — you are
 * sitting there. On a marketplace skill somebody else published, the human who
 * could resolve it is never coming, so the run simply dies. From the outside a
 * published skill whose page moved one button is indistinguishable from a skill
 * that has never worked, and that is what most of the marketplace looks like.
 *
 * What makes turning it on defensible is not confidence in the model. It is
 * that it only ever runs on a step that was ALREADY going to fail, through the
 * same locator and egress guard as a recorded step, hard-capped, with secrets
 * withheld. The worst case is the behaviour we already had.
 */

const original = process.env.AEMULUS_AGENT_FALLBACK;

describe("the agentic fallback", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.AEMULUS_AGENT_FALLBACK;
    else process.env.AEMULUS_AGENT_FALLBACK = original;
  });

  it("is on when nothing is configured", () => {
    delete process.env.AEMULUS_AGENT_FALLBACK;
    expect(agentFallbackEnabled()).toBe(true);
  });

  // An explicit off, and only that. An operator who genuinely cannot allow
  // model-chosen actions needs a way out that does not depend on remembering
  // the exact truthy spelling.
  it("is off only when explicitly set to 0", () => {
    process.env.AEMULUS_AGENT_FALLBACK = "0";
    expect(agentFallbackEnabled()).toBe(false);
  });

  it("stays on for any other value", () => {
    for (const v of ["1", "true", "yes", ""]) {
      process.env.AEMULUS_AGENT_FALLBACK = v;
      expect(agentFallbackEnabled()).toBe(true);
    }
  });
});

/**
 * A watch check must stay free of model calls.
 *
 * The separate, cheaper watch allowance was argued on exactly one fact: a check
 * replays a few steps and reads a value, and makes no model calls — that is why
 * 48 checks a day are priced the way they are. The vision verifier was removed
 * from the watch path for that reason and the runner still skips it there.
 *
 * The agentic fallback would have walked straight back in. Worse than the
 * verifier: a watch whose selector broke fails on EVERY check, so it would
 * invoke the agent 48 times a day for as long as the watch exists, on a path
 * built to fail quietly — the owner is told once, at the broken threshold, and
 * never again. Unbounded spend nobody can see.
 */
describe("what a watch check is allowed to cost", () => {
  const src = readFileSync("lib/runner.ts", "utf8");

  it("keeps the agent out of watch runs", () => {
    // Both call sites: the one that cannot locate the element, and the one
    // where something is covering it.
    const guarded = src.match(/agentFallbackEnabled\(\)[\s\S]{0,200}?!isWatch/g) ?? [];
    expect(guarded.length).toBe(2);
  });

  it("still skips the vision verifier there, for the same reason", () => {
    expect(src).toMatch(/finalStatus === "completed" && finalShot && !isWatch/);
  });
});

/**
 * What the fallback is allowed to send, now that nobody opted in.
 *
 * agenticStep screenshots the page and posts it to the model — that is how it
 * decides what to click. While the flag was opt-in, an operator turning it on
 * was accepting that. On by default, nobody accepted anything.
 *
 * The runner auto-fills vault credentials, so a run can be signed into the
 * owner's own QuickBooks, Salesforce or Zendesk. The step record already keeps a
 * secret VALUE out of the prompt, but a screenshot is not a value: the image is
 * whatever that account can see. So a credentialed run keeps the old behaviour
 * and pauses for a human. A public page — what every marketplace skill runs on —
 * still gets repaired.
 */
describe("what the fallback may send to a model", () => {
  const src = readFileSync("lib/runner.ts", "utf8");

  it("will not screenshot a page somebody is signed in to", () => {
    expect(src).toMatch(/const credentialed = vaultKeys\.size > 0 \|\| secretFieldKeys\.size > 0/);
    const guarded = src.match(/agentFallbackEnabled\(\)[\s\S]{0,260}?!credentialed/g) ?? [];
    expect(guarded.length).toBe(2);
  });

  // Both conditions, not either: a watch check is excluded on cost, a
  // credentialed run on disclosure. Neither reason covers the other.
  it("keeps the watch and credential exclusions independent", () => {
    const guarded = src.match(/agentFallbackEnabled\(\)[\s\S]{0,260}?!isWatch/g) ?? [];
    expect(guarded.length).toBe(2);
  });
});
