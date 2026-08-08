import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ruleIsUsable } from "../lib/watches";
import {
  DEFAULT_ACTION,
  parseAction,
  shouldAlert,
  type WatchAction,
} from "../lib/watch-action";

describe("parseAction", () => {
  it("falls back to alert-only for anything unusable", () => {
    for (const raw of [null, undefined, "run_skill", 7, {}, { kind: "nope" }]) {
      expect(parseAction(raw)).toEqual(DEFAULT_ACTION);
    }
  });

  it("refuses a run_skill action with no target", () => {
    // Storing half an action and acting on it later is worse than not having
    // one: the watch would look armed and do nothing.
    expect(parseAction({ kind: "run_skill" })).toEqual(DEFAULT_ACTION);
    expect(parseAction({ kind: "run_skill", skillId: "   " })).toEqual(DEFAULT_ACTION);
  });

  it("reads a real action", () => {
    expect(parseAction({ kind: "run_skill", skillId: " skl_1 " })).toEqual({
      kind: "run_skill",
      skillId: "skl_1",
      alsoAlert: true,
    });
  });

  it("only an explicit false silences the message", () => {
    // Something that just went and did work on your behalf should say so unless
    // you asked otherwise. An omitted field is not asking.
    expect(parseAction({ kind: "run_skill", skillId: "s" }).kind === "run_skill").toBe(true);
    expect(shouldAlert(parseAction({ kind: "run_skill", skillId: "s" }))).toBe(true);
    expect(shouldAlert(parseAction({ kind: "run_skill", skillId: "s", alsoAlert: 0 }))).toBe(true);
    expect(shouldAlert(parseAction({ kind: "run_skill", skillId: "s", alsoAlert: false }))).toBe(
      false,
    );
  });
});

describe("shouldAlert", () => {
  it("an alert-only watch always alerts", () => {
    expect(shouldAlert(DEFAULT_ACTION)).toBe(true);
    expect(shouldAlert({ kind: "alert" } as WatchAction)).toBe(true);
  });
});

describe("a watch with no action at all", () => {
  // Every watch that predates this column reads back with action undefined.
  // The dereference used to sit outside fireWatchAction's try, so that threw a
  // TypeError which escaped into evaluateWatchForRun's catch and swallowed the
  // alert — a watch losing its message because it has no action.
  it("still alerts", () => {
    expect(shouldAlert(undefined)).toBe(true);
    expect(shouldAlert(null)).toBe(true);
  });

  it("does not throw when fired", async () => {
    const { fireWatchAction } = await import("../lib/watch-action");
    await expect(
      fireWatchAction({
        action: undefined,
        owner: "w",
        watchedSkillId: "s",
        key: "k",
        value: "v",
        scheduleId: "sch",
      }),
    ).resolves.toEqual({ ran: false, reason: "alert only" });
  });
});

describe("the rule set while recording reaches the skill", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the popup collects an operator and an operand", () => {
    const html = read("extension/popup.html");
    expect(html).toMatch(/id="ruleop"/);
    expect(html).toMatch(/id="ruleval"/);
    for (const op of ["below", "above", "contains", "appears", "disappears"]) {
      expect(html).toContain(`value="${op}"`);
    }
  });

  it("the rule travels with the capture, and is cleared when capture ends", () => {
    const js = read("extension/popup.js");
    expect(js).toMatch(/aemWatchOp: on \? /); // set while on
    expect(js).toMatch(/aemWatchOp: on \? \$\("ruleop"\)\.value : ""/); // cleared when off
  });

  it("the content script attaches it to the extract action", () => {
    const cs = read("extension/content.js");
    expect(cs).toMatch(/watchOp: watchOp \|\| undefined/);
    // An operand without an operator is meaningless and must not be stored.
    expect(cs).toMatch(/watchValue: watchOp && watchValue/);
  });

  it("the trace edge only accepts operators the evaluator knows", () => {
    // Otherwise a client could store an op that no evaluator handles, and the
    // watch would look armed while never being satisfiable.
    // And the set is BUILT from the evaluator's list rather than retyped, so a
    // new op cannot exist in one place and not the other.
    const route = read("app/api/ext/trace/route.ts");
    expect(route).toMatch(/import \{ WATCH_OPS \} from "@\/lib\/watches"/);
    expect(route).toMatch(/new Set<string>\(WATCH_OPS\)/);
    expect(route).toMatch(/watchOp: KNOWN_OPS\.has/);
  });

  it("generalize splices the rule onto the restored capture", () => {
    expect(read("lib/generalize.ts")).toMatch(/watchOp: a\.watchOp/);
  });
});

describe("the site screen for the rule", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("prefills from what the recorder captured", () => {
    // The whole point of asking at record time is not asking again here.
    const panel = read("components/SchedulePanel.tsx");
    expect(panel).toMatch(/captures\.find\(\(s\) => s\.watchOp\)/);
    expect(panel).toMatch(/recorded\?\.watchOp as WatchOp\) \?\? "changed"/);
    expect(panel).toMatch(/recorded\?\.watchValue \?\? ""/);
  });

  it("only offers a watch when the skill captures something", () => {
    // A skill with no named value has nothing to compare, so the section is
    // absent rather than present and broken.
    expect(read("components/SchedulePanel.tsx")).toMatch(/captures\.length > 0 &&/);
  });

  it("only sends an operand for the ops that take one", () => {
    const panel = read("components/SchedulePanel.tsx");
    expect(panel).toMatch(/NEEDS_VALUE\.includes\(op\) \? \{ value: opValue \}/);
  });

  it("passes the live steps, not the saved ones", () => {
    // A rule added to a capture in the editor should be offered immediately,
    // without saving and reloading first.
    expect(read("components/SkillEditor.tsx")).toMatch(/plan=\{steps\}/);
  });

  it("removes the schedule when the rule cannot be attached", () => {
    // Otherwise it fires checks nothing reads — burning the watch allowance
    // every cadence and reporting nothing, forever.
    const route = read("app/api/schedules/route.ts");
    expect(route).toMatch(/if \(!attached\)/);
    expect(route).toMatch(/deleteSchedule\(id, session\.pubkey\)/);
  });
});

describe("a rule that can never fire is refused", () => {
  // parseNumber("") returns null, so matches() answers inconclusive forever: the
  // watch runs every cadence, burns the allowance, and can never alert. On the
  // schedules page it looks armed the whole time, and the symptom is
  // indistinguishable from a page that simply is not changing.
  it("needs an operand for the ops that compare", () => {
    for (const op of ["equals", "contains", "not_contains", "above", "below"] as const) {
      expect(ruleIsUsable({ op })).toBe(false);
      expect(ruleIsUsable({ op, value: "   " })).toBe(false);
      expect(ruleIsUsable({ op, value: "5" })).toBe(true);
    }
  });

  it("needs nothing for the ops that don't compare", () => {
    for (const op of ["changed", "appears", "disappears"] as const) {
      expect(ruleIsUsable({ op })).toBe(true);
    }
  });

  it("is enforced by both routes, not only the screen", () => {
    // The public API is the one anyone can call.
    expect(readFileSync("app/api/v1/watches/route.ts", "utf8")).toMatch(/ruleIsUsable\(rule\)/);
    expect(readFileSync("app/api/schedules/route.ts", "utf8")).toMatch(/ruleIsUsable\(rule\)/);
  });

  it("the screen refuses to submit one", () => {
    const panel = readFileSync("components/SchedulePanel.tsx", "utf8");
    expect(panel).toMatch(/ruleIsUsable\(\{ op, value: opValue \}\)/);
    expect(panel).toMatch(/disabled=\{busy \|\| !ruleReady\}/);
  });
});
