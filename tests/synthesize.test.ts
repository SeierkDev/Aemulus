import { describe, it, expect } from "vitest";
import { varianceIssues } from "../lib/synthesize";
import type { Demonstration, GeneralizedSkill, SkillStep } from "../lib/types";

function demo(values: string[]): Demonstration {
  return {
    id: "d",
    owner: "W",
    title: "t",
    startUrl: "",
    trace: values.map((v, idx) => ({
      idx,
      type: "input" as const,
      value: v,
      selectors: [],
      url: "",
      ts: 0,
    })),
    createdAt: 0,
  } as Demonstration;
}

function step(valueSource: SkillStep["valueSource"]): Omit<SkillStep, "idx"> {
  return {
    intent: "i",
    action: valueSource === "none" ? "click" : "input",
    selectors: [],
    target: "t",
    valueSource,
    value: valueSource === "constant" ? "Office Supplies" : "",
    inputKey: valueSource === "input" ? "k" : "",
    key: "",
  };
}

function skill(sources: SkillStep["valueSource"][]): GeneralizedSkill {
  return {
    name: "s",
    description: "d",
    inputFields: [],
    steps: sources.map(step),
  };
}

// vendor + amount vary, category identical across the two demos
const demos = [
  demo(["Acme", "1499", "Office Supplies"]),
  demo(["Beta", "2200", "Office Supplies"]),
];

describe("synthesize verifier (varianceIssues)", () => {
  it("passes when inputs vary and constants are stable", () => {
    expect(varianceIssues(skill(["input", "input", "constant"]), demos)).toEqual([]);
  });

  it("flags a varying value wrongly marked constant", () => {
    const issues = varianceIssues(skill(["input", "constant", "constant"]), demos);
    expect(issues.some((i) => i.includes("#2") && i.includes("MUST be an input"))).toBe(true);
  });

  it("flags a stable value wrongly marked input", () => {
    const issues = varianceIssues(skill(["input", "input", "input"]), demos);
    expect(issues.some((i) => i.includes("#3") && i.includes("should be a constant"))).toBe(true);
  });

  it("flags demos with mismatched value counts", () => {
    const mixed = [demo(["Acme", "1499"]), demo(["Beta", "2200", "Office Supplies"])];
    expect(
      varianceIssues(skill(["input", "input"]), mixed).some((i) =>
        i.includes("different numbers of typed values"),
      ),
    ).toBe(true);
  });
});
