import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OPS_NEEDING_VALUE, recordedRule, ruleFitsCapture, ruleSentence } from "../lib/watches";

const ex = (o: Record<string, unknown>) => ({ action: "extract", ...o }) as never;

describe("recordedRule", () => {
  it("reads the rule set while recording", () => {
    expect(recordedRule([ex({ outputKey: "pnl", watchOp: "below", watchValue: "5" })])).toEqual({
      key: "pnl",
      op: "below",
      value: "5",
    });
  });

  it("is null for skills recorded before rules existed", () => {
    expect(recordedRule([ex({ outputKey: "pnl" })])).toBeNull();
    expect(recordedRule([])).toBeNull();
  });

  it("ignores non-extract steps and unknown operators", () => {
    expect(recordedRule([{ action: "click", watchOp: "below" } as never])).toBeNull();
    expect(recordedRule([ex({ outputKey: "k", watchOp: "explodes" })])).toBeNull();
  });

  it("does not need an operand for the ops that take none", () => {
    expect(recordedRule([ex({ outputKey: "banner", watchOp: "appears" })])).toEqual({
      key: "banner",
      op: "appears",
    });
  });

  it("falls back to changed when an operand-taking op has no operand", () => {
    // Half a rule is worse than none: "below" with nothing to be below can never
    // be satisfied, so the watch would look armed and never fire.
    expect(recordedRule([ex({ outputKey: "pnl", watchOp: "below", watchValue: "  " })])).toEqual({
      key: "pnl",
      op: "changed",
    });
  });

  it("takes the first capture that carries one", () => {
    expect(
      recordedRule([
        ex({ outputKey: "a" }),
        ex({ outputKey: "b", watchOp: "above", watchValue: "10" }),
      ]),
    ).toEqual({ key: "b", op: "above", value: "10" });
  });
});

describe("the recorded rule reaches the surface watches are made on", () => {
  const tg = readFileSync("lib/telegram-commands.ts", "utf8");

  it("the Telegram flow no longer hardcodes changed", () => {
    // This is where most watches are created. Hardcoding op:"changed" here threw
    // away the answer given at the only moment the person was looking at the
    // value, and every watch silently became "tell me when it changes".
    expect(tg).toMatch(/recordedRule\(skill\.plan, key\)/);
    expect(tg).not.toMatch(/setWatch\(\s*scheduleId,\s*owner,\s*\{ key, op: "changed" \}/);
  });

  it("only applies a recorded rule to the key the user picked", () => {
    expect(tg).toMatch(/fromRecording\.key === key/);
  });

  it("refuses a recorded rule that could never fire", () => {
    expect(tg).toMatch(/ruleIsUsable\(fromRecording\)/);
  });

  it("says which rule is in force", () => {
    // A watch on a stricter rule is quieter than the default. Not saying so
    // makes a working watch look broken.
    expect(tg).toMatch(/ruleSentence\(rule\)/);
  });
});

describe("ruleSentence", () => {
  it("reads as a sentence for each op", () => {
    expect(ruleSentence({ key: "pnl", op: "below", value: "5" })).toBe(
      "when pnl goes below 5",
    );
    expect(ruleSentence({ key: "banner", op: "appears" })).toBe(
      "when banner starts showing a value",
    );
    expect(ruleSentence({ key: "x", op: "changed" })).toContain("different from the time before");
  });
});

describe("a watch is legible from the pages you manage it on", () => {
  // A schedule that is really a watch, and a watch that STARTS A SKILL when it
  // fires, both rendered exactly like a plain scheduled run. Something that
  // spends quota and acts on your behalf has to be visible where you'd go to
  // stop it.
  it("the schedule row carries the rule and whether it acts", () => {
    const sched = readFileSync("lib/schedules.ts", "utf8");
    expect(sched).toMatch(/watch: watchSummary\(row\)/);
    expect(sched).toMatch(/actionSkillId: action && action\.kind === "run_skill"/);
  });

  it("the site page shows the rule, not just that a schedule exists", () => {
    const page = readFileSync("app/schedules/page.tsx", "utf8");
    expect(page).toMatch(/ruleSentence\(s\.watch\)/);
    expect(page).toMatch(/s\.watch\.actionSkillId &&/);
  });

  it("/watches says the rule rather than only the field", () => {
    // "below 5" and "whenever it changes" are very different watches, and both
    // are quiet — showing only the field made the stricter one look broken.
    const tg = readFileSync("lib/telegram-commands.ts", "utf8");
    expect(tg).toMatch(/ruleSentence\(w\.rule\)/);
    expect(tg).toMatch(/Then it runs \*\$\{mdEscape\(actionNames\.get/);
  });
});

describe("an armed watch can be disarmed", () => {
  // Seeing that something runs skills on your behalf and having no way to stop
  // it short of deleting the watch is worse than not showing it. Deleting takes
  // the baseline with it, so the replacement stays quiet through the first real
  // change — exactly when you were watching for one.
  it("clearing the action does not touch the watch", () => {
    const route = readFileSync("app/api/schedules/[id]/route.ts", "utf8");
    expect(route).toMatch(/export async function PATCH/);
    expect(route).toMatch(/setWatchAction\(id, session\.pubkey, \{ kind: "alert" \}\)/);
    // It must not fall through to deleting anything. Scoped to the PATCH body:
    // a whole-file match finds deleteSchedule in the DELETE handler below and
    // asserts nothing.
    const body = route.slice(
      route.indexOf("export async function PATCH"),
      route.indexOf("export async function POST"),
    );
    expect(body).toContain("setWatchAction");
    expect(body).not.toContain("deleteSchedule");
  });

  it("the control only appears when there is something to stop", () => {
    expect(readFileSync("app/schedules/page.tsx", "utf8")).toMatch(
      /acts=\{!!s\.watch\?\.actionSkillId\}/,
    );
    expect(readFileSync("components/ScheduleControls.tsx", "utf8")).toMatch(/\{acts && \(/);
  });
});

describe("the public API can see and undo what it armed", () => {
  const item = readFileSync("app/api/v1/watches/[id]/route.ts", "utf8");
  const list = readFileSync("app/api/v1/watches/route.ts", "utf8");

  it("the listing says whether a watch runs a skill", () => {
    // A watch that STARTS A SKILL is materially different from one that only
    // messages, and a consumer had no way to tell them apart — including the
    // one it had just created itself.
    expect(list).toMatch(/action:\s*\n?\s*w\.action && w\.action\.kind === "run_skill"/);
  });

  it("PATCH can clear the action", () => {
    // Arming something through the API and having to visit a website to stop it
    // is not an API.
    expect(item).toMatch(/action: z\.literal\("alert"\)\.optional\(\)/);
    expect(item).toMatch(/setWatchAction\(id, auth\.owner, \{ kind: "alert" \}\)/);
  });

  it("still requires the caller to ask for something", () => {
    expect(item).toMatch(/b\.active !== undefined \|\| b\.action !== undefined/);
  });

  it("clearing the action does not delete the watch", () => {
    const body = item.slice(
      item.indexOf("export async function PATCH"),
      item.indexOf("export async function DELETE"),
    );
    expect(body).not.toContain("deleteSchedule");
  });
});

describe("the published artifacts describe what the API now does", () => {
  it("the SDK can arm, see and clear an action", () => {
    // A developer on the published package could not use the feature at all:
    // no way to set one, no field to read one, no way to stop one.
    const sdk = readFileSync("sdk/index.ts", "utf8");
    expect(sdk).toMatch(/export type WatchAction/);
    expect(sdk).toMatch(/action\?: WatchAction;/);
    expect(sdk).toMatch(/clearWatchAction\(id: string\)/);
  });

  it("the SDK version moved with the surface", () => {
    const pkg = JSON.parse(readFileSync("sdk/package.json", "utf8"));
    expect(pkg.version).not.toBe("0.2.0");
  });

  it("the OpenAPI spec mentions the action on both create and patch", () => {
    const spec = readFileSync("lib/openapi.ts", "utf8");
    expect(spec).toMatch(/run_skill/);
    expect(spec).toMatch(/Pause, resume, or disarm a watch/);
  });
});

describe("the docs a developer actually reads", () => {
  it("the SDK README covers watches and the action", () => {
    // The package is published; a README that omits a headline capability is
    // the same defect as an SDK that cannot express it.
    const readme = readFileSync("sdk/README.md", "utf8");
    expect(readme).toMatch(/createWatch/);
    expect(readme).toMatch(/clearWatchAction/);
    expect(readme).toMatch(/run_skill/);
  });

  it("the developers page example is not still on the old API", () => {
    const page = readFileSync("app/developers/page.tsx", "utf8");
    expect(page).toMatch(/action: \{ kind: "run_skill"/);
    expect(page).toMatch(/clearWatchAction/);
  });
});

describe("saving a skill keeps the rule it was recorded with", () => {
  it("the step schema does not strip it", async () => {
    // zod strips unknown keys by default, so leaving watchOp out of
    // SkillStepSchema silently deleted it on EVERY save: record a rule, edit
    // anything about the skill, and the answer given while looking at the value
    // was gone with nothing said.
    const { SkillUpdateBody } = await import("../lib/validate");
    const parsed = SkillUpdateBody.parse({
      plan: [
        {
          idx: 0,
          intent: "Read pnl",
          action: "extract",
          selectors: [],
          target: "",
          valueSource: "none",
          value: "",
          inputKey: "",
          key: "",
          outputKey: "pnl",
          watchOp: "below",
          watchValue: "5",
        },
      ],
    });
    expect(parsed.plan?.[0]).toMatchObject({ watchOp: "below", watchValue: "5" });
  });

  it("still refuses an operator the evaluator does not know", async () => {
    const { SkillUpdateBody } = await import("../lib/validate");
    expect(() =>
      SkillUpdateBody.parse({
        plan: [
          {
            idx: 0, intent: "x", action: "extract", selectors: [], target: "",
            valueSource: "none", value: "", inputKey: "", key: "",
            watchOp: "explodes",
          },
        ],
      }),
    ).toThrow();
  });

  it("the editor exposes it, like every other field on the step", () => {
    const ed = readFileSync("components/SkillEditor.tsx", "utf8");
    expect(ed).toMatch(/Step \$\{i \+ 1\} watch rule/);
    expect(ed).toMatch(/watchValue: e\.target\.value/);
    // Switching to an op that takes no operand must not leave a stale one behind.
    expect(ed).toMatch(/\{ watchValue: undefined \}/);
  });
});

describe("choosing a different value re-reads its own rule", () => {
  const panel = readFileSync("components/SchedulePanel.tsx", "utf8");

  it("the key dropdown re-derives the op and operand", () => {
    // With pnl recorded as "below 5" and holders as "above 1000", switching the
    // dropdown used to keep pnl's rule and apply it to holders — a watch that
    // matches neither recording, with nothing on screen saying so.
    expect(panel).toMatch(/captures\.find\(\(c\) => c\.outputKey === next\)/);
    expect(panel).toMatch(/setOp\(\(cap\?\.watchOp as WatchOp\) \?\? "changed"\)/);
    expect(panel).toMatch(/setOpValue\(cap\?\.watchValue \?\? ""\)/);
  });

  it("the badge follows the selected capture, not any capture", () => {
    // Otherwise it claimed "from your recording" while showing the default for
    // a value that never had one.
    expect(panel).toMatch(/captures\.find\(\(c\) => c\.outputKey === key\)\?\.watchOp &&/);
  });
});

describe("a numeric rule on a list capture", () => {
  const steps = [
    { action: "extract", outputKey: "prices", loop: true },
    { action: "extract", outputKey: "total", loop: false },
  ];

  it("is refused, because it would silently read the first number in the array", () => {
    // Measured: parseNumber('["42 items","7 items"]') is 42. A "below 5" rule on
    // that list does not fail loudly — it watches 42 and calls it the list.
    expect(ruleFitsCapture({ key: "prices", op: "below" }, steps)).toBe(false);
    expect(ruleFitsCapture({ key: "prices", op: "above" }, steps)).toBe(false);
  });

  it("leaves the ops that do work on a list alone", () => {
    for (const op of ["changed", "contains", "not_contains", "appears", "disappears"]) {
      expect(ruleFitsCapture({ key: "prices", op }, steps)).toBe(true);
    }
  });

  it("does not interfere with a normal capture", () => {
    expect(ruleFitsCapture({ key: "total", op: "below" }, steps)).toBe(true);
  });

  it("says nothing about a key it cannot find", () => {
    // The route resolves the skill; an unknown key fails elsewhere.
    expect(ruleFitsCapture({ key: "ghost", op: "below" }, steps)).toBe(true);
  });

  it("is enforced by both routes and hidden in both screens", () => {
    expect(readFileSync("app/api/v1/watches/route.ts", "utf8")).toMatch(/ruleFitsCapture\(rule, skill\.plan\)/);
    expect(readFileSync("app/api/schedules/route.ts", "utf8")).toMatch(/ruleFitsCapture\(rule, skill\.plan\)/);
    expect(readFileSync("components/SchedulePanel.tsx", "utf8")).toMatch(/outputKey === key\)\?\.loop &&/);
    expect(readFileSync("components/SkillEditor.tsx", "utf8")).toMatch(/\{!s\.loop && \(/);
  });
});

describe("appears / disappears say what they actually detect", () => {
  it("the sentence does not promise element removal", () => {
    // The evaluator compares the captured TEXT going empty or non-empty. If the
    // element is gone the extract step cannot locate it, the run ends in
    // needs_review, and that is treated as a failed check — deliberately, so a
    // value missing because a login lapsed is not reported as it disappearing.
    expect(ruleSentence({ key: "banner", op: "disappears" })).toBe(
      "when banner stops showing a value",
    );
    expect(ruleSentence({ key: "banner", op: "appears" })).toBe(
      "when banner starts showing a value",
    );
  });

  it("every screen offering it uses the same words", () => {
    for (const f of [
      "components/SchedulePanel.tsx",
      "components/SkillEditor.tsx",
      "app/record/page.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("stops showing a value");
      expect(src).not.toMatch(/<option value="disappears">disappears</);
    }
  });

  it("the watch screen explains the distinction where it is chosen", () => {
    expect(readFileSync("components/SchedulePanel.tsx", "utf8")).toMatch(
      /removed from the page entirely is reported as the watch\s*\n?\s*failing/,
    );
  });
});

describe("moving a watch's alerts is not the same as changing its rule", () => {
  it("/here updates only where alerts go", () => {
    // setWatch deliberately resets the baseline, because a NEW RULE has to start
    // clean. Moving alerts to a chat is not a new rule, and routing it through
    // setWatch wiped what the page last said — so a change that happened while
    // the person was setting the chat up became the new normal and was never
    // reported. Silently, and exactly when they were adding people to watch it.
    const tg = readFileSync("lib/telegram-commands.ts", "utf8");
    expect(tg).toMatch(/setWatchNotify\(w\.id, owner, \{/);
    const here = tg.slice(tg.indexOf("const watch = await getWatch(w.id)"));
    expect(here.slice(0, 700)).not.toMatch(/await setWatch\(/);
  });

  it("the notify-only update leaves the state column alone", () => {
    const sched = readFileSync("lib/schedules.ts", "utf8");
    const fn = sched.slice(
      sched.indexOf("export async function setWatchNotify"),
      sched.indexOf("/** Attach or replace the watch rule"),
    );
    expect(fn).toMatch(/UPDATE schedules SET notify = \? WHERE id = \? AND owner = \?/);
    expect(fn).not.toMatch(/watch_state/);
  });
});

describe("the wizard holds a recorded rule to the same tests as the site", () => {
  it("a numeric rule recorded on a list capture does not survive", () => {
    // The exact shape both other creation paths answer with a 400: a rule that
    // compares numbers, against a capture that collects a list. It does not
    // fail at check time — it reads the first number and answers confidently
    // about the wrong thing.
    const plan = [ex({ outputKey: "prices", loop: true, watchOp: "above", watchValue: "100" })];
    const rec = recordedRule(plan)!;
    expect(rec.op).toBe("above");
    expect(ruleFitsCapture(rec, plan)).toBe(false);
  });

  it("the Telegram wizard applies both guards, not just the first", () => {
    const tg = readFileSync("lib/telegram-commands.ts", "utf8");
    const at = tg.indexOf("const fromRecording = recordedRule(skill.plan, key)");
    expect(at).toBeGreaterThan(0);
    const block = tg.slice(at);
    expect(block.slice(0, 400)).toMatch(/ruleFitsCapture\(fromRecording, skill\.plan\)/);
  });
});

describe("the action picker only offers skills a watch can actually run", () => {
  it("templates and chaining skills are filtered out of the triggerable list", () => {
    const page = readFileSync("app/skills/[id]/page.tsx", "utf8");
    expect(page).toMatch(
      /triggerableSkills = others\s*\n?\s*\.filter\(\(s\) => !templateTool\(s\) && !planHasChaining\(s\.plan\)\)/,
    );
  });

  it("the chain-step editor keeps the unfiltered list", () => {
    // It renders an ALREADY SAVED target by id. Handing it the filtered list
    // would draw an existing step as unset and invite someone to "fix" it.
    const ed = readFileSync("components/SkillEditor.tsx", "utf8");
    expect(ed).toMatch(/otherSkills=\{triggerableSkills\}/);
    expect(ed).toMatch(/\{otherSkills\.map\(\(o\) => \(/);
  });
});

describe("what the API says a watch does", () => {
  it("a single watch reports its action, like the list does", () => {
    // The SDK documents action as always present, so an absent field does not
    // read as unknown — it reads as "alert". Every consumer checking one watch
    // was told it only messages, including one that runs a skill.
    const item = readFileSync("app/api/v1/watches/[id]/route.ts", "utf8");
    const get = item.slice(item.indexOf("export async function GET"));
    expect(get).toMatch(/kind: "run_skill", skillId: w\.action\.skillId/);
    expect(get).toMatch(/: \{ kind: "alert" \}/);
  });

  it("the SDK's promise that it is always present holds on both paths", () => {
    const sdk = readFileSync("sdk/index.ts", "utf8");
    expect(sdk).toMatch(/Always present; "alert" when unset/);
    for (const f of ["app/api/v1/watches/route.ts", "app/api/v1/watches/[id]/route.ts"]) {
      expect(readFileSync(f, "utf8")).toMatch(/action:\s*\n?\s*w\.action && w\.action\.kind === "run_skill"/);
    }
  });
});

describe("an action that could never run is refused where it is set", () => {
  it("both create routes check the target before the watch exists", () => {
    for (const f of ["app/api/schedules/route.ts", "app/api/v1/watches/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/actionTargetProblem\(\s*\n?\s*(parsedAction|parsed)\.skillId/);
      // And it rolls the schedule back, like the rule checks around it — a
      // schedule with a dead action still burns the allowance every cadence.
      const at = src.indexOf("await actionTargetProblem");
      expect(at).toBeGreaterThan(0);
      expect(src.slice(at, at + 400)).toMatch(/deleteSchedule\(id/);
    }
  });

  it("the reasons match what chain refuses at fire time", () => {
    const wa = readFileSync("lib/watch-action.ts", "utf8");
    const fn = wa.slice(wa.indexOf("export async function actionTargetProblem"));
    for (const guard of ["skillAccess", "templateTool", "planHasChaining"]) {
      expect(fn.slice(0, 900)).toContain(guard);
    }
    const chain = readFileSync("lib/chain.ts", "utf8");
    for (const guard of ["skillAccess", "templateTool", "planHasChaining"]) {
      expect(chain).toContain(guard);
    }
  });
});

describe("the extension's copy of the rule vocabulary", () => {
  const html = readFileSync("extension/popup.html", "utf8");
  const js = readFileSync("extension/popup.js", "utf8");

  it("offers exactly the operators the evaluator knows", () => {
    // The extension is a separate bundle and cannot import lib/watches, so its
    // list is a copy. An op offered here that the evaluator does not know
    // travels all the way to a stored rule that can never be satisfied.
    const offered = [...html.matchAll(/<option value="([^"]*)">/g)]
      .map((m) => m[1])
      .filter((v, i, a) => a.indexOf(v) === i && v !== "");
    const known: string[] = [
      "changed", "equals", "contains", "not_contains",
      "above", "below", "appears", "disappears",
    ];
    for (const op of offered) expect(known).toContain(op);
  });

  it("shows the operand box for exactly the ops that take one", () => {
    // Drift here is silent: the box hides for an op that needs a value, the
    // rule is stored without one, and recordedRule falls back to "changed" —
    // a watch that quietly ignores the condition you set.
    const m = js.match(/function needsOperand\(op\) \{\s*return \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const inExt = m![1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean).sort();
    expect(inExt).toEqual([...OPS_NEEDING_VALUE].sort());
  });

  it("uses the same words as the site, including for disappears", () => {
    expect(html).toContain("stops showing a value");
    expect(html).toContain("starts showing a value");
    expect(html).toContain("stops containing");
    expect(html).not.toMatch(/<option value="disappears">disappears</);
  });
});

describe("a recording with more than one rule", () => {
  const plan = [
    ex({ outputKey: "price", watchOp: "below", watchValue: "5" }),
    ex({ outputKey: "status", watchOp: "equals", watchValue: "sold" }),
  ];

  it("answers for the capture asked about, not the first one recorded", () => {
    expect(recordedRule(plan, "status")).toEqual({ key: "status", op: "equals", value: "sold" });
    expect(recordedRule(plan, "price")).toEqual({ key: "price", op: "below", value: "5" });
  });

  it("still answers with the first when no capture is named", () => {
    expect(recordedRule(plan)).toEqual({ key: "price", op: "below", value: "5" });
  });

  it("says nothing for a capture that carries no rule", () => {
    expect(recordedRule([...plan, ex({ outputKey: "holders" })], "holders")).toBeNull();
  });

  it("the wizard asks for the capture the person picked", () => {
    // It offers every capture as its own button, so the one being watched is
    // known here — and asking without it handed back another capture's rule,
    // which was discarded on the key check and became "tell me when it changes".
    const tg = readFileSync("lib/telegram-commands.ts", "utf8");
    expect(tg).toMatch(/recordedRule\(skill\.plan, key\)/);
  });
});

describe("turning a capture into a list", () => {
  it("drops a numeric rule instead of leaving it on the step", () => {
    // The numeric options are hidden for a list capture, but hiding them does
    // not remove one already chosen: the select rendered blank because no
    // option matched, while the step still carried "above 100" — and the watch
    // screen refused it later, about a rule this screen no longer showed.
    const ed = readFileSync("components/SkillEditor.tsx", "utf8");
    const at = ed.indexOf("Step ${i + 1} capture all matches");
    expect(at).toBeGreaterThan(0);
    const block = ed.slice(at, at + 900);
    expect(block).toMatch(/watchOp === "above" \|\| s\.watchOp === "below"/);
    expect(block).toMatch(/watchOp: undefined, watchValue: undefined/);
  });
});

describe("a watch that acts says what it runs", () => {
  it("the site names the skill and links to it", () => {
    // "then runs a skill" and nothing more. An action can only be disarmed,
    // never edited, so no surface would tell you what you had armed.
    const page = readFileSync("app/schedules/page.tsx", "utf8");
    expect(page).toMatch(/names\.get\(s\.watch\.actionSkillId\)/);
    expect(page).toMatch(/href=\{`\/skills\/\$\{s\.watch\.actionSkillId\}`\}/);
    // And it does not silently render an empty line for one out of reach.
    expect(page).toContain("a skill you can no longer open");
  });

  it("Telegram names it too", () => {
    const tg = readFileSync("lib/telegram-commands.ts", "utf8");
    expect(tg).toMatch(/actionNames\.get\(w\.action\.skillId\)/);
    expect(tg).toContain("Then it runs a skill you can no longer open.");
  });

  it("neither pays for the lookup when no watch acts", () => {
    // One extra query on a page that renders on every visit, for a column most
    // watches do not use.
    expect(readFileSync("app/schedules/page.tsx", "utf8")).toMatch(
      /schedules\.some\(\(s\) => s\.watch\?\.actionSkillId\)/,
    );
    expect(readFileSync("lib/telegram-commands.ts", "utf8")).toMatch(
      /watches\.some\(\(\{ w \}\) => w\.action\?\.kind === "run_skill"\)/,
    );
  });
});
