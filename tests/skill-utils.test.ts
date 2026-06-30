import { describe, it, expect } from "vitest";
import { skillTargets, categorize, recordedNavHosts } from "../lib/skill-utils";
import { GeneralizedSchema } from "../lib/generalize";
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

describe("recordedNavHosts (allowlist from REAL navigations, not model output)", () => {
  it("returns hostnames only from recorded navigate actions", () => {
    const trace = [
      { type: "navigate", url: "https://realsite.com/login" },
      { type: "click", url: "https://realsite.com/login" },
      { type: "navigate", url: "https://app.realsite.com/x" },
    ];
    expect(recordedNavHosts(trace).sort()).toEqual(["app.realsite.com", "realsite.com"]);
  });

  it("a model-injected navigate host is NOT included (only real navs count)", () => {
    // The recording only ever visited realsite.com; an injected attacker host
    // in the generated plan must not appear here (it feeds allowedHosts).
    const trace = [{ type: "navigate", url: "https://realsite.com/" }];
    expect(recordedNavHosts(trace)).toEqual(["realsite.com"]);
    expect(recordedNavHosts(trace)).not.toContain("attacker.tld");
  });
});

describe("GeneralizedSchema caps model output", () => {
  const field = { key: "k", label: "l", example: "" };
  const step = {
    intent: "i",
    action: "click" as const,
    selectors: [],
    target: "",
    valueSource: "none" as const,
    value: "",
    inputKey: "",
    key: "",
  };
  it("rejects a plan beyond 200 steps", () => {
    const r = GeneralizedSchema.safeParse({
      name: "n",
      description: "d",
      inputFields: [field],
      steps: Array.from({ length: 201 }, () => step),
    });
    expect(r.success).toBe(false);
  });
  it("rejects an oversized field value", () => {
    const r = GeneralizedSchema.safeParse({
      name: "n",
      description: "d",
      inputFields: [{ ...field, example: "x".repeat(5001) }],
      steps: [step],
    });
    expect(r.success).toBe(false);
  });
});

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
