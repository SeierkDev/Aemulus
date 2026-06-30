import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, getSkill, updateSkill } from "../../lib/skills";
import { hostInAllowlist } from "../../lib/safe-url";
import type { GeneralizedSkill } from "../../lib/types";

const navStep = {
  intent: "go",
  action: "navigate" as const,
  selectors: [],
  target: "https://app.example.com/login",
  valueSource: "none" as const,
  value: "",
  inputKey: "",
  key: "",
};
const GEN: GeneralizedSkill = {
  name: "A",
  description: "",
  inputFields: [],
  steps: [navStep],
};

beforeAll(async () => {
  await ready();
});

describe("hostInAllowlist", () => {
  it("empty list = unrestricted; else exact + subdomain match", () => {
    expect(hostInAllowlist("https://evil.com/x", [])).toBe(true);
    expect(hostInAllowlist("https://example.com/x", ["example.com"])).toBe(true);
    expect(hostInAllowlist("https://app.example.com/x", ["example.com"])).toBe(true);
    expect(hostInAllowlist("https://evil.com/x", ["example.com"])).toBe(false);
    // not a sneaky suffix match
    expect(hostInAllowlist("https://notexample.com/x", ["example.com"])).toBe(false);
    // data:/blob: are never allowed as a navigation target (even with empty list)
    expect(hostInAllowlist("data:text/html,hi", ["example.com"])).toBe(false);
    expect(hostInAllowlist("data:text/html,hi", [])).toBe(false);
    expect(hostInAllowlist("blob:https://x/abc", [])).toBe(false);
  });
});

describe("skill allowlist persistence", () => {
  it("new skills auto-restrict to their navigation hosts; editor can change it", async () => {
    const s = await createSkill({ owner: "ALLOW_O", generalized: GEN, sourceDemoId: null });
    expect(s.allowedHosts).toEqual(["app.example.com"]);

    await updateSkill(s.id, {
      name: s.name,
      description: s.description,
      plan: s.plan,
      inputSchema: s.inputSchema,
      allowedHosts: ["example.com", "cdn.example.com"],
    });
    expect((await getSkill(s.id))!.allowedHosts).toEqual([
      "example.com",
      "cdn.example.com",
    ]);
  });
});
