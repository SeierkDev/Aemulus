import { describe, it, expect } from "vitest";
import { skillTargets, categorize } from "../lib/skill-utils";
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

describe("categorize", () => {
  it("maps skills to a category by keyword", () => {
    expect(categorize("Add invoice to QuickBooks", "")).toBe("Finance");
    expect(categorize("Add lead to HubSpot", "create a contact")).toBe("CRM");
    expect(categorize("Log support ticket to Zendesk", "")).toBe("Support");
    expect(categorize("Post job to LinkedIn", "")).toBe("Hiring");
    expect(categorize("Create Shopify product", "")).toBe("Commerce");
  });

  it("falls back to Other", () => {
    expect(categorize("Do a thing", "somewhere")).toBe("Other");
  });
});
