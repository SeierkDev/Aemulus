import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { restoreCaptures } from "../lib/generalize";
import type { Demonstration, GeneralizedSkill } from "../lib/types";

/**
 * Recording a task more than once is what you do to make a skill MORE reliable.
 * It used to cost you the ability to watch it: the multi-demonstration path
 * never restored captures, and the model's own schema cannot emit an extract
 * action, so the skill came back with none — and the rule set while recording
 * went with them.
 */

const demo = (trace: unknown[]): Demonstration =>
  ({ id: "d", owner: "o", title: "t", startUrl: null, createdAt: 0, trace }) as Demonstration;

const skill = (): GeneralizedSkill =>
  ({
    name: "S",
    description: "d",
    inputFields: [],
    steps: [
      {
        intent: "open",
        action: "navigate",
        selectors: [],
        target: "https://x.test",
        valueSource: "none",
        value: "",
        inputKey: "",
        key: "",
      },
    ],
  }) as unknown as GeneralizedSkill;

describe("multi-demonstration synthesis", () => {
  it("puts the captures back, with the rule attached", () => {
    const d = demo([
      { idx: 0, type: "navigate", url: "https://x.test", ts: 0 },
      {
        idx: 1,
        type: "extract",
        url: "https://x.test",
        ts: 1,
        selectors: [".pnl"],
        outputKey: "pnl",
        watchOp: "below",
        watchValue: "5",
      },
    ]);
    const out = restoreCaptures(skill(), d);
    const cap = out.steps.find((s) => s.action === "extract");
    expect(cap).toBeDefined();
    expect(cap).toMatchObject({ outputKey: "pnl", watchOp: "below", watchValue: "5" });
  });

  it("is wired into the multi-demo path, not only the single one", () => {
    const src = readFileSync("lib/synthesize.ts", "utf8");
    expect(src).toMatch(/restoreCaptures\(marked, withCaptures\)/);
    // From one demo, not a fold: every take of the same task carries the same
    // captures, so folding would splice each one in again per demo.
    expect(src).toMatch(/demos\.find\(\(d\) => d\.trace\?\.some/);
  });
});
