import { describe, it, expect } from "vitest";
import { dropDeadOpeningNavigation } from "../lib/generalize";
import { resolveValue } from "../lib/runner";
import type { GeneralizedSkill, SkillStep } from "../lib/types";

/**
 * The promise these two behaviours keep: record a task, press Run, and it does
 * the task. No editing the plan first.
 */

const nav = (target: string) => ({
  intent: `open ${target}`,
  action: "navigate" as const,
  selectors: [],
  target,
  valueSource: "none" as const,
  value: "",
});
const click = () => ({
  intent: "click something",
  action: "click" as const,
  selectors: [".x"],
  target: "",
  valueSource: "none" as const,
  value: "",
});

function skill(steps: unknown[]): GeneralizedSkill {
  return { name: "S", description: "d", inputFields: [], steps } as unknown as GeneralizedSkill;
}

describe("dropDeadOpeningNavigation", () => {
  it("drops the tab you happened to be on when you pressed Start", () => {
    // Real case: the user was looking at aemulusai.com, hit Start, then went to
    // Solscan. Step 00 loaded an unrelated site on every replay.
    const out = dropDeadOpeningNavigation(
      skill([nav("https://aemulusai.com/"), nav("https://solscan.io/account/X"), click()]),
    );
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0].target).toBe("https://solscan.io/account/X");
  });

  it("keeps a navigation that something actually follows", () => {
    const steps = [nav("https://a.com"), click(), nav("https://b.com")];
    expect(dropDeadOpeningNavigation(skill(steps)).steps).toHaveLength(3);
  });

  it("never empties a one-step skill", () => {
    expect(dropDeadOpeningNavigation(skill([nav("https://a.com")])).steps).toHaveLength(1);
  });

  it("leaves a plan that doesn't start with a navigation alone", () => {
    const steps = [click(), nav("https://a.com")];
    expect(dropDeadOpeningNavigation(skill(steps)).steps).toHaveLength(2);
  });
});

describe("resolveValue falls back to what was demonstrated", () => {
  const step = {
    idx: 1,
    intent: "go to the account page",
    action: "navigate" as const,
    selectors: [],
    target: "",
    valueSource: "input" as const,
    inputKey: "account_url",
    value: "",
  } as unknown as SkillStep;

  const examples = new Map([["account_url", "https://solscan.io/account/X"]]);

  it("uses the recorded value when the run supplies nothing", () => {
    // This is the bug: without a fallback the step navigated to "", and the run
    // died on "Invalid URL." before doing anything.
    expect(resolveValue(step, {}, examples)).toBe("https://solscan.io/account/X");
    expect(resolveValue(step, { account_url: "" }, examples)).toBe(
      "https://solscan.io/account/X",
    );
    expect(resolveValue(step, { account_url: "   " }, examples)).toBe(
      "https://solscan.io/account/X",
    );
  });

  it("a supplied value always wins", () => {
    expect(resolveValue(step, { account_url: "https://solscan.io/account/Y" }, examples)).toBe(
      "https://solscan.io/account/Y",
    );
  });

  it("is unchanged when there is no example to fall back to", () => {
    expect(resolveValue(step, {}, new Map())).toBe("");
    expect(resolveValue(step, {})).toBe("");
  });

  it("leaves constants and valueless steps alone", () => {
    const constStep = { ...step, valueSource: "constant", value: "fixed" } as unknown as SkillStep;
    expect(resolveValue(constStep, {}, examples)).toBe("fixed");
    const none = { ...step, valueSource: "none" } as unknown as SkillStep;
    expect(resolveValue(none, {}, examples)).toBe("");
  });
});
