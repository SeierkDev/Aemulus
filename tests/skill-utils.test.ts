import { describe, it, expect } from "vitest";
import { skillTargets } from "../lib/skill-utils";
import type { SkillStep } from "../lib/types";

function nav(target: string): SkillStep {
  return {
    idx: 0,
    intent: "open",
    action: "navigate",
    selectors: [],
    target,
    valueSource: "none",
    value: "",
    inputKey: "",
    key: "",
  };
}
function click(): SkillStep {
  return { ...nav(""), action: "click", intent: "click", target: "Button" };
}

describe("skillTargets", () => {
  it("extracts unique hostnames from navigate steps", () => {
    const plan = [
      nav("https://app.example.com/new"),
      click(),
      nav("https://app.example.com/save"),
      nav("https://other.io/x"),
    ];
    expect(skillTargets(plan).sort()).toEqual(["app.example.com", "other.io"]);
  });

  it("labels data: URLs as inline and ignores non-navigate steps", () => {
    expect(skillTargets([nav("data:text/html,<p>x</p>"), click()])).toEqual([
      "inline page",
    ]);
  });

  it("skips unparseable targets", () => {
    expect(skillTargets([nav("not a url")])).toEqual([]);
  });
});
