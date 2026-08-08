import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { restoreCaptures } from "../lib/generalize";
import { incompleteRecordingReason } from "../lib/skill-utils";
import type { Demonstration, GeneralizedSkill } from "../lib/types";

/**
 * Capture mode: click the value instead of writing a selector.
 *
 * The whole feature exists because a watch needs a skill that READS something,
 * and the only way to make one was to open DevTools, copy a CSS selector and
 * paste it into the skill editor. Everything else about recording is "just do
 * the task"; that one step asked for frontend knowledge, so in practice nobody
 * made a watchable skill.
 */

const step = (o: Partial<GeneralizedSkill["steps"][number]> = {}) =>
  ({
    intent: "", action: "click", selectors: [], target: "",
    valueSource: "none", value: "", inputKey: "", key: "", outputKey: "",
    ...o,
  }) as GeneralizedSkill["steps"][number];

const skill = (steps: GeneralizedSkill["steps"]) =>
  ({ name: "S", description: "", inputFields: [], steps }) as GeneralizedSkill;

const demo = (trace: unknown[]) => ({ trace }) as unknown as Demonstration;

describe("captures survive generalization", () => {
  /**
   * The model cannot emit them: StepSchema in generalize.ts has no "extract" in
   * its action enum, so a capture the model tried to produce would fail the
   * parse. That is deliberate — a capture is exact user intent, and a model
   * rewriting the selector can only lose information — so they are spliced back
   * in from the trace instead.
   */
  it("adds an extract step the model could never have produced", () => {
    const out = restoreCaptures(
      skill([step({ action: "navigate" })]),
      demo([
        { type: "navigate" },
        { type: "extract", selectors: [".total"], name: "Total", value: "$42.00" },
      ]),
    );
    expect(out.steps).toHaveLength(2);
    expect(out.steps[1].action).toBe("extract");
    expect(out.steps[1].selectors).toEqual([".total"]);
  });

  // Position matters: a capture taken on page 2 of a task must read page 2, not
  // whatever the last page happened to show.
  it("puts a capture back where it was taken", () => {
    const out = restoreCaptures(
      skill([step({ action: "navigate" }), step({ action: "click" }), step({ action: "submit" })]),
      demo([
        { type: "navigate" },
        { type: "extract", selectors: [".mid"], name: "Mid" },
        { type: "click" },
        { type: "submit" },
      ]),
    );
    expect(out.steps.map((s) => s.action)).toEqual([
      "navigate", "extract", "click", "submit",
    ]);
  });

  it("uses the name you gave it", () => {
    const out = restoreCaptures(
      skill([step()]),
      demo([{ type: "click" }, { type: "extract", outputKey: "price", selectors: ["#p"] }]),
    );
    expect(out.steps[1].outputKey).toBe("price");
  });

  it("derives a usable key when you did not name it", () => {
    const out = restoreCaptures(
      skill([step()]),
      demo([{ type: "click" }, { type: "extract", name: "Order Total!", selectors: ["#p"] }]),
    );
    expect(out.steps[1].outputKey).toBe("order_total");
  });

  // Two "Total" cells on one page would otherwise collapse into one output and
  // silently drop a capture the user took deliberately.
  it("keeps two captures with the same label apart", () => {
    const out = restoreCaptures(
      skill([step()]),
      demo([
        { type: "click" },
        { type: "extract", name: "Total", selectors: ["#a"] },
        { type: "extract", name: "Total", selectors: ["#b"] },
      ]),
    );
    const keys = out.steps.filter((s) => s.action === "extract").map((s) => s.outputKey);
    expect(new Set(keys).size).toBe(2);
  });

  // Order in the array IS the order: a generalized step is
  // Omit<SkillStep,"idx">, and the index gets assigned when the skill is saved.
  it("keeps the plan in order", () => {
    const out = restoreCaptures(
      skill([step({ intent: "one" }), step({ intent: "two" })]),
      demo([{ type: "click" }, { type: "extract", selectors: ["#a"] }, { type: "click" }]),
    );
    expect(out.steps.map((s) => s.action)).toEqual(["click", "extract", "click"]);
    expect(out.steps.map((s) => s.intent)).toEqual(["one", "Read value", "two"]);
  });

  it("leaves a recording with no captures untouched", () => {
    const original = skill([step(), step()]);
    const out = restoreCaptures(original, demo([{ type: "click" }, { type: "click" }]));
    expect(out).toBe(original);
  });
});

describe("a capture is a finished recording", () => {
  /**
   * Open a page, click the number, stop. That is exactly what a watch needs and
   * it is one interaction — so the three-interaction rule called it unfinished,
   * and there was no way to make a watchable skill without padding the
   * recording with clicks that do nothing.
   */
  it("accepts navigate-then-capture", () => {
    expect(
      incompleteRecordingReason([{ type: "navigate" }, { type: "extract" }]),
    ).toBeNull();
  });

  // The rule still does the job it was written for.
  it("still rejects a task abandoned early", () => {
    expect(
      incompleteRecordingReason([{ type: "navigate" }, { type: "click" }]),
    ).toMatch(/unfinished/);
  });
});

describe("what the recorder does while capturing", () => {
  const inject = readFileSync("lib/recorder-inject.ts", "utf8");
  const ext = readFileSync("extension/content.js", "utf8");

  /**
   * A capture on a link must not navigate. Letting the click through would move
   * the page out from under the value being pointed at — and on a form, submit
   * it — which is the one thing that makes the feature feel broken.
   */
  it("swallows the click in both recorders", () => {
    for (const src of [inject, ext]) {
      expect(src).toMatch(/preventDefault\(\)/);
      expect(src).toMatch(/stopPropagation\(\)/);
    }
  });

  it("reports what it read, so you can see it took the right thing", () => {
    for (const src of [inject, ext]) {
      expect(src).toMatch(/readValue/);
      expect(src).toMatch(/type: "extract"/);
    }
  });

  // The outline chasing itself is the classic version of this bug.
  it("never outlines its own overlay", () => {
    for (const src of [inject, ext]) {
      expect(src).toMatch(/data-aem-outline/);
    }
  });
});

describe("the extension announces itself", () => {
  it("marks the document so the site can stop nagging", () => {
    expect(readFileSync("extension/content.js", "utf8")).toMatch(
      /setAttribute\("data-aemulus-extension"/,
    );
    expect(readFileSync("app/record/page.tsx", "utf8")).toMatch(/data-aemulus-extension/);
  });

  it("ships as a new version", () => {
    const m = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
    expect(m.version).toBe("0.1.3");
  });
});

/**
 * Three things the first version of this got wrong.
 *
 * All found by scanning rather than by a failing test, which is the point of
 * writing them down here: each one is silent, and two of them look fine.
 */
describe("what the first cut missed", () => {
  const inject = readFileSync("lib/recorder-inject.ts", "utf8");
  const ext = readFileSync("extension/content.js", "utf8");
  const rec = readFileSync("lib/recorder.ts", "utf8");

  /**
   * A capture on a credential field is still a credential.
   *
   * The typed-input path has redacted these since the recorder was written.
   * Reading one instead of typing it is the same disclosure — and capture mode
   * skipped the check, so pointing at a password field would have written it
   * into the trace in cleartext.
   */
  it("redacts a captured secret in both recorders", () => {
    for (const src of [inject, ext]) {
      expect(src).toMatch(/isSensitive\(el\)/);
      // readValue now takes an optional cap, so allow the argument.
      expect(src).toMatch(/secret \? "" : readValue\(el[,)]/);
      expect(src).toMatch(/sensitive: true/);
    }
  });

  /**
   * Playwright cannot remove an init script. Toggling capture via addInitScript
   * left one script per toggle, all of them running on every later page load,
   * each overwriting the last — the final value is correct, which is exactly
   * what makes it easy to miss.
   */
  it("does not add an init script per toggle", () => {
    const adds = rec.match(/addInitScript\(/g) ?? [];
    expect(adds).toHaveLength(1); // the recorder script itself, once
    expect(rec).toMatch(/applyCapture/);
  });

  // Capture state lives on window, so a navigation wipes it. Clicking through
  // to the page that holds the value would otherwise drop you back into normal
  // recording without saying so.
  it("re-applies capture after a navigation", () => {
    expect(rec).toMatch(/framenavigated[\s\S]{0,160}applyCapture/);
  });

  // Naming was in the plan and absent from the build: outputKey was read in the
  // UI and set by nothing.
  it("lets you name a capture in both recorders", () => {
    expect(readFileSync("app/record/page.tsx", "utf8")).toMatch(/captureKey/);
    expect(readFileSync("extension/popup.js", "utf8")).toMatch(/aemCaptureKey/);
    expect(inject).toMatch(/__aemCaptureKey/);
    expect(ext).toMatch(/captureKey/);
  });
});

/**
 * Where a capture goes back into the plan.
 *
 * The first version counted trace actions and used that as a step index. The
 * model does not emit one step per action — it merges and splits, because the
 * plan is a generalization of the trace rather than a copy — so the count is
 * only occasionally the index. A capture placed wrongly reads the wrong page,
 * which on a multi-page task means silently watching something nobody asked
 * about.
 */
describe("placing a capture when the model rewrote the plan", () => {
  it("anchors to the step before it, even when the counts disagree", () => {
    const out = restoreCaptures(
      // Model emitted 2 steps from 4 trace actions.
      skill([
        step({ action: "navigate", selectors: ["#nav"] }),
        step({ action: "click", selectors: ["#pay"] }),
      ]),
      demo([
        { type: "navigate", selectors: ["#nav"] },
        { type: "click", selectors: ["#pay"] },
        { type: "extract", selectors: ["#total"], outputKey: "total" },
        { type: "click", selectors: ["#done"] },
      ]),
    );
    // Straight after the step it was taken on, not appended at the end.
    expect(out.steps.map((s) => s.action)).toEqual(["navigate", "click", "extract"]);
  });

  it("still lands mid-plan when the anchor is an earlier step", () => {
    const out = restoreCaptures(
      skill([
        step({ action: "navigate", selectors: ["#nav"] }),
        step({ action: "click", selectors: ["#pay"] }),
        step({ action: "submit", selectors: ["#go"] }),
      ]),
      demo([
        { type: "navigate", selectors: ["#nav"] },
        { type: "extract", selectors: ["#t"], outputKey: "t" },
        { type: "click", selectors: ["#pay"] },
        { type: "submit", selectors: ["#go"] },
      ]),
    );
    expect(out.steps.map((s) => s.action)).toEqual([
      "navigate", "extract", "click", "submit",
    ]);
  });

  // No anchor and no alignment: appending is a guess, but it is the least wrong
  // one — a capture is usually the end of what you were doing.
  it("appends when it cannot tell", () => {
    const out = restoreCaptures(
      skill([step({ action: "navigate", selectors: ["#a"] })]),
      demo([
        { type: "click", selectors: ["#unknown"] },
        { type: "extract", selectors: ["#t"], outputKey: "t" },
      ]),
    );
    expect(out.steps[out.steps.length - 1].action).toBe("extract");
  });
});

describe("the live trace", () => {
  it("says what a capture read, not just that one happened", () => {
    const src = readFileSync("components/record/Trace.tsx", "utf8");
    expect(src).toMatch(/case "extract"/);
    expect(src).toMatch(/Capture \$\{/);
  });
});

/**
 * The preview has to be the truth.
 *
 * What the recorder shows you when you click a value is the only evidence you
 * get that you captured the right thing. If it reads the element differently
 * from the way a run reads it, you are checking one number and watching
 * another.
 */
describe("what you see is what gets captured", () => {
  const runner = readFileSync("lib/runner.ts", "utf8");
  const inject = readFileSync("lib/recorder-inject.ts", "utf8");
  const ext = readFileSync("extension/content.js", "utf8");

  // captureValue in the runner: inputValue() for form controls, textContent()
  // for everything else. innerText is NOT the same — it reflects what is
  // rendered and collapses whitespace, while textContent includes hidden nodes
  // and keeps it.
  it("reads the same property the runner reads", () => {
    expect(runner).toMatch(/textContent\(\)/);
    for (const src of [inject, ext]) {
      // Scoped to readValue: accessibleName legitimately uses innerText, because
      // a label is what a human SEES, which is a different question from what a
      // capture reads.
      const fn = src.slice(src.indexOf("function readValue"), src.indexOf("function readValue") + 400);
      expect(fn).toMatch(/el\.textContent \|\| ""/);
      expect(fn).not.toMatch(/innerText/);
    }
  });

  it("still uses the field's value for form controls, as the runner does", () => {
    expect(runner).toMatch(/inputValue\(\)/);
    for (const src of [inject, ext]) {
      expect(src).toMatch(/input\|textarea\|select/);
    }
  });
});

describe("starting a second recording", () => {
  /**
   * Capture is off in a fresh recorder. The button kept the previous session's
   * state, so it would read "Capturing" while the server was not — and the
   * first click would press the thing you were aiming at instead of reading it,
   * which costs the whole recording.
   */
  it("does not inherit capture mode from the last one", () => {
    const src = readFileSync("app/record/page.tsx", "utf8");
    expect(src).toMatch(/async function start\(\)[\s\S]{0,500}setCapturing\(false\)/);
  });

  // The extension does this already, via setRecState.
  it("is already true in the extension", () => {
    const popup = readFileSync("extension/popup.js", "utf8");
    expect(popup).toMatch(/if \(!recording\) setCaptureState\(false\)/);
  });
});

/**
 * A credential capture must never become a step.
 *
 * The recorder blanking the value protects the RECORDING, and that is all it
 * protects. An extract step reads its element live on every run, and nothing on
 * that path is masked — outputs[key] is persisted, folded into the commitment
 * and the receipt, returned by the SDK, and disclosable. Masking in the runner
 * is gated entirely on step.inputKey and secretFieldKeys, which are about typed
 * inputs.
 *
 * So the recording leaks once and the step would leak forever. It is dropped.
 */
describe("capturing a password field", () => {
  it("produces no step at all", () => {
    const out = restoreCaptures(
      skill([step({ action: "navigate", selectors: ["#nav"] })]),
      demo([
        { type: "navigate", selectors: ["#nav"] },
        { type: "extract", selectors: ["#pw"], outputKey: "pw", value: "", sensitive: true },
      ]),
    );
    expect(out.steps.some((s) => s.action === "extract")).toBe(false);
  });

  it("does not stop the ordinary captures around it", () => {
    const out = restoreCaptures(
      skill([step({ action: "navigate", selectors: ["#nav"] })]),
      demo([
        { type: "navigate", selectors: ["#nav"] },
        { type: "extract", selectors: ["#pw"], sensitive: true },
        { type: "extract", selectors: ["#total"], outputKey: "total" },
      ]),
    );
    const ex = out.steps.filter((s) => s.action === "extract");
    expect(ex).toHaveLength(1);
    expect(ex[0].outputKey).toBe("total");
  });

  // Vanishing silently would leave somebody re-recording and wondering why.
  it("says why in the live trace", () => {
    const src = readFileSync("components/record/Trace.tsx", "utf8");
    expect(src).toMatch(/Capture refused/);
  });

  // The thing that makes this necessary: there is no masking on the extract path.
  it("is necessary because the runner does not mask an extract", () => {
    const runner = readFileSync("lib/runner.ts", "utf8");
    const block = runner.slice(runner.indexOf('if (step.action === "extract")'), runner.indexOf('if (step.action === "extract")') + 900);
    expect(block).toMatch(/outputs\[key\]/);
    expect(block).not.toMatch(/secretFieldKeys|vaultKeys/);
  });
});

/**
 * The extension's captures have to survive the trip.
 *
 * The extension records a capture, posts it to /api/ext/trace, and that route
 * filters actions against a whitelist of types. "extract" was not on it — so
 * every capture the extension recorded was dropped on arrival, silently,
 * because a filtered action leaves nothing behind to notice. The extension half
 * of this feature did nothing at all.
 */
describe("a capture recorded in the extension", () => {
  const route = readFileSync("app/api/ext/trace/route.ts", "utf8");

  it("is an accepted action type", () => {
    const set = route.slice(route.indexOf("ACTION_TYPES"), route.indexOf("MAX_ACTIONS"));
    expect(set).toMatch(/"extract"/);
  });

  it("keeps the name the user gave it", () => {
    expect(route).toMatch(/outputKey: str\(a\.outputKey/);
  });

  // Same redaction as everywhere else: the route already blanks a sensitive
  // value, and generalize drops the step entirely.
  it("is still refused when it is a credential", () => {
    expect(route).toMatch(/value: sensitive \? "" :/);
  });

  /**
   * Every type the extension can send must be accepted, or it goes in the bin
   * without a word. This compares the two lists rather than trusting that
   * anyone remembers to update both.
   */
  it("accepts every type the extension actually sends", () => {
    const ext = readFileSync("extension/content.js", "utf8");
    const sent = new Set([...ext.matchAll(/send\(\{\s*type:\s*"(\w+)"/g)].map((m) => m[1]));
    const accepted = route.slice(route.indexOf("ACTION_TYPES"), route.indexOf("MAX_ACTIONS"));
    for (const t of sent) expect(accepted).toContain(`"${t}"`);
  });
});

/**
 * What the extension says about itself.
 *
 * PRIVACY.md is published and is what a Chrome reviewer reads. It described the
 * extension as accessing "the field values you type" — a capture reads text the
 * user did NOT type, which is a different category of data, so the disclosure
 * was incomplete for the version that introduces it.
 */
describe("the extension's own docs", () => {
  it("discloses that a capture reads text you did not type", () => {
    const privacy = readFileSync("extension/PRIVACY.md", "utf8");
    expect(privacy).toMatch(/Capture a value/);
    expect(privacy).toMatch(/text you did\s+not type/);
  });

  // The refusal is a privacy property, not just a safeguard — worth stating
  // where somebody deciding whether to install can read it.
  it("says a credential capture is refused", () => {
    expect(readFileSync("extension/PRIVACY.md", "utf8")).toMatch(
      /credential-shaped field is refused/,
    );
  });

  it("tells you how to record one", () => {
    const readme = readFileSync("extension/README.md", "utf8");
    expect(readme).toMatch(/Capture a value/);
    // The reason anybody would: a skill with no capture cannot be watched.
    expect(readme).toMatch(/a watch needs one that \*reads\* something/);
  });
});

/**
 * The button has to follow the recorder, not just remember what was asked for.
 *
 * Capture lived only in React state, so reloading the page mid-recording showed
 * "Capture a value" while the recorder was still capturing — and that is the
 * dangerous direction. You look at an off button, click something in the live
 * view expecting to press it, and it gets read instead.
 */
describe("the capture button and the recorder agree", () => {
  const page = readFileSync("app/record/page.tsx", "utf8");

  it("takes capture state from the server on every poll", () => {
    expect(page).toMatch(/next\.capturing/);
    expect(page).toMatch(/setCapturing\(next\.capturing\)/);
  });

  // The server already reports it; nothing was reading it.
  it("is reported by the recorder's snapshot", () => {
    const rec = readFileSync("lib/recorder.ts", "utf8");
    expect(rec).toMatch(/return \{ \.\.\.this\.state, actions/);
    expect(readFileSync("lib/types.ts", "utf8")).toMatch(/capturing\?: boolean/);
  });

  /**
   * …but not while a toggle is in flight. The poll runs every 1.2s and the
   * server does not know about the switch until its POST lands, so one arriving
   * in that window would report the old value and flip the button back under
   * the user's finger — a flicker introduced by the fix above if left unguarded.
   */
  it("does not let a poll undo a toggle mid-flight", () => {
    expect(page).toMatch(/togglingRef/);
    expect(page).toMatch(/!togglingRef\.current &&/);
    expect(page).toMatch(/finally \{\s*togglingRef\.current = false;/);
  });
});

/**
 * Naming a capture after you turned capture on.
 *
 * The key was posted with the toggle and nowhere else, so switching capture on
 * and THEN typing a name left the server holding the old one — the capture came
 * back named after the element's label, which reads as the naming field being
 * ignored rather than unread. The extension already pushed it live on every
 * keystroke; only the web recorder was behind.
 */
describe("the name reaches the recorder while you type it", () => {
  const page = readFileSync("app/record/page.tsx", "utf8");

  it("posts the key on change, not only on toggle", () => {
    expect(page).toMatch(/useEffect\([\s\S]{0,900}captureKey\.trim\(\)[\s\S]{0,600}\[captureKey,[^\]]*capturing\]/);
  });

  it("debounces, rather than a request per keystroke", () => {
    // Sliced generously: the comment above it is long, and a tight window
    // ended before the cleanup line and failed on code that was there.
    const block = page.slice(page.indexOf("Send the name as it is typed"), page.indexOf("async function toggleCapture"));
    expect(block).toMatch(/setTimeout\(/);
    expect(block).toMatch(/clearTimeout\(t\)/);
  });

  // A failed rename must not interrupt a recording in progress.
  it("never lets a naming failure break the recording", () => {
    const block = page.slice(page.indexOf("Send the name as it is typed"), page.indexOf("async function toggleCapture"));
    expect(block).toMatch(/\.catch\(/);
  });

  it("matches what the extension already did", () => {
    const popup = readFileSync("extension/popup.js", "utf8");
    expect(popup).toMatch(/capturekey"\)\.addEventListener\("input"/);
  });
});

/**
 * Nothing survives a recording that should not.
 *
 * Recorders are per-owner singletons, reused across recordings, so anything
 * held on the instance outlives the session that set it. `accepted` was already
 * reset on start; the capture name was not, and the next recording would have
 * inherited it.
 */
describe("a new recording starts clean", () => {
  const rec = readFileSync("lib/recorder.ts", "utf8");

  it("clears the capture name on start, next to the counter that already was", () => {
    expect(rec).toMatch(/this\.accepted = 0;[\s\S]{0,320}this\.captureKey = "";/);
  });

  // capturing lives on state, and start() builds a fresh state object, so it
  // resets by construction rather than by being remembered.
  it("gets capture mode off by building a new state", () => {
    expect(rec).toMatch(/this\.state = \{\s*\n\s*id: sid,/);
    const start = rec.slice(rec.indexOf("const sid = id(\"rec\")"), rec.indexOf("const sid = id(\"rec\")") + 700);
    expect(start).not.toMatch(/capturing:/); // absent → falsy → off
  });
});

/**
 * Both recorders reach the same completeness check.
 *
 * A capture-only recording is legal, and it has to be legal on BOTH paths — the
 * extension posts its trace straight to /api/ext/trace, then the user
 * generalizes on the site, which is where the check lives.
 */
describe("a capture-only recording is accepted from either recorder", () => {
  it("is checked in one place, on the generalize route", () => {
    const route = readFileSync("app/api/skills/generalize/route.ts", "utf8");
    expect(route).toMatch(/incompleteRecordingReason\(demo\.trace\)/);
  });
});

/**
 * A captured skill has to actually run in the extension.
 *
 * The extension replays skills as well as recording them, and performStep
 * handled navigate, click, input, select, key and submit. An extract step fell
 * through every branch and returned ok having read nothing — so a skill with a
 * capture ran "successfully" and produced no value, and a watch on it failed
 * every check with "did not capture the field". Silently, because the run
 * reported success.
 *
 * Worse, the extension never sent outputs at all: ext-run.ts accepts them and
 * calls setRunOutput, and nothing was collecting them. The whole point of
 * capture mode is a watch on a page only you can see, which is precisely the
 * page the extension exists for.
 */
describe("running a captured skill in the extension", () => {
  const content = readFileSync("extension/content.js", "utf8");
  const bg = readFileSync("extension/background.js", "utf8");

  it("reads the element instead of falling through", () => {
    expect(content).toMatch(/action === "extract"/);
    // Sliced to the end of the branch, not a fixed width: these comments are
    // long, and a tight window has now failed twice on code that was there.
    const from = content.indexOf('action === "extract"');
    const branch = content.slice(from, content.indexOf('action === "submit"', from));
    expect(branch).toMatch(/value: readValue\(el\)/);
  });

  it("collects what each extract read", () => {
    expect(bg).toMatch(/outputs\[outKey\]/);
    expect(bg).toMatch(/step\.outputKey \|\| `value_\$\{step\.idx\}`/);
  });

  it("sends them with the finished run", () => {
    expect(bg).toMatch(/steps: results, outputs,/);
    // The server has always been ready for them.
    expect(readFileSync("app/api/ext/runs/[id]/finish/route.ts", "utf8")).toMatch(/body\?\.outputs/);
  });

  /**
   * On a step the deterministic selector missed, `res` holds the FAILED attempt
   * — the value came back from the vision path. Reading res.value there gives
   * an empty output on exactly the runs where the page had drifted, which is
   * when a watch matters most.
   */
  it("keeps the value when the vision fallback rescued the step", () => {
    expect(bg).toMatch(/value: res\.value, tokensIn/);
    expect(bg).toMatch(/extracted = rescue\.value/);
    expect(bg).toMatch(/extracted !== undefined \? extracted : res && res\.value/);
  });

  // `key` in that function is the API key it posts with. Shadowing it inside
  // the loop is the kind of thing that works until someone moves a line.
  it("does not shadow the API key", () => {
    const loop = bg.slice(bg.indexOf("const outputs = {}"), bg.indexOf("setStatus({ state: \"finishing\""));
    expect(loop).not.toMatch(/const key =/);
  });
});

/**
 * The two runners must produce the same shape.
 *
 * "Capture all matching elements" (step.loop) makes an extract return a JSON
 * array instead of a single value. The cloud runner has honoured it since
 * in-skill loops shipped; the extension's new extract branch read one element
 * and ignored the flag — so the same skill produced an array in the cloud and a
 * bare string in the extension, and a watch would compare one shape against the
 * other depending on where the run happened.
 *
 * The plan is handed to the extension whole (`plan: skill.plan`), so the flag
 * was there to read all along.
 */
describe("in-skill loops in the extension", () => {
  const content = readFileSync("extension/content.js", "utf8");
  const runner = readFileSync("lib/runner.ts", "utf8");

  it("returns an array when the step says capture them all", () => {
    const from = content.indexOf('action === "extract"');
    const branch = content.slice(from, content.indexOf('action === "submit"', from));
    expect(branch).toMatch(/step\.loop/);
    expect(branch).toMatch(/querySelectorAll/);
    expect(branch).toMatch(/JSON\.stringify\(values\)/);
  });

  // Same serialisation as the cloud runner, or the values differ in shape.
  it("serialises the same way the cloud runner does", () => {
    expect(runner).toMatch(/outputs\[key\] = JSON\.stringify\(values\)/);
  });

  // A page with thousands of rows must not turn one step into an unbounded
  // payload — the runner caps it, so this does too.
  it("caps the number captured, as the runner does", () => {
    expect(content).toMatch(/LOOP_MAX = 500/);
    expect(runner).toMatch(/AEMULUS_LOOP_MAX\)\s*\|\|\s*500/);
  });

  it("receives the flag at all", () => {
    expect(readFileSync("app/api/ext/runs/start/route.ts", "utf8")).toMatch(/plan: skill\.plan/);
  });
});

/**
 * How much of a value gets captured.
 *
 * The cloud runner caps at 20,000 characters. The extension capped at 300 —
 * copied from the recording preview, where 300 is plenty to confirm you grabbed
 * the right thing. As a VALUE it means a long capture reads differently
 * depending on which runner ran it: the watch sees a change that never happened,
 * or misses one past character 300.
 *
 * The replay ceiling is the server's own limit for a client-reported output
 * (4000, in the finish route) rather than the runner's 20,000. That gap is
 * deliberate: the runner reads the page itself, while this is a number the
 * extension claims.
 */
describe("how much of a captured value survives", () => {
  const content = readFileSync("extension/content.js", "utf8");

  it("keeps the short cap for the preview and a real one for the value", () => {
    expect(content).toMatch(/CAPTURE_PREVIEW_MAX = 300/);
    expect(content).toMatch(/CAPTURE_VALUE_MAX = 4000/);
    // The recording path is the preview; the replay path is not.
    expect(content).toMatch(/readValue\(el, CAPTURE_PREVIEW_MAX\)/);
  });

  it("does not truncate before the server would", () => {
    expect(readFileSync("extension/background.js", "utf8")).toMatch(/read\.slice\(0, 4000\)/);
    expect(readFileSync("app/api/ext/runs/[id]/finish/route.ts", "utf8")).toMatch(/v\.slice\(0, 4000\)/);
  });

  /**
   * .map(readValue) passes (element, index, array) — the index lands in the
   * `max` parameter and truncates element 1 to one character, element 2 to two.
   * Introduced by the fix above, caught before it shipped.
   */
  it("does not hand map's index to the cap", () => {
    // Comments stripped first: the fix carries a comment that names the wrong
    // form in order to warn about it, and matching prose would fail on code
    // that is correct.
    const code = content
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/\.map\(readValue\)/);
    expect(code).toMatch(/\.map\(\(e\) => readValue\(e\)\)/);
  });
});

/**
 * Reopening the popup must not erase what is in it.
 *
 * The popup called setCaptureState on open merely to REFLECT the stored state —
 * and that function persists the key from the input box, which is empty on open
 * because nothing had filled it in yet. So typing a name, closing the popup and
 * opening it again silently threw the name away. Looking at the state destroyed
 * the state.
 */
describe("the popup restoring itself", () => {
  const popup = readFileSync("extension/popup.js", "utf8");

  it("separates drawing the controls from saving a change", () => {
    expect(popup).toMatch(/function renderCapture\(on\)/);
    const render = popup.slice(popup.indexOf("function renderCapture"), popup.indexOf("function setCaptureState"));
    expect(render).not.toMatch(/storage\.local\.set/);
  });

  it("restores the name from storage rather than overwriting it", () => {
    expect(popup).toMatch(/\$\("capturekey"\)\.value = c\.aemCaptureKey \|\| ""/);
    expect(popup).toMatch(/renderCapture\(!!c\.aemCapturing\)/);
    // Asked for in the restore get. Matched loosely on purpose: pinning it to
    // the end of the array broke the moment another key was added after it,
    // which says nothing about whether the name is still restored.
    expect(popup).toMatch(/storage\.local\.get\(\[[^\]]*"aemCaptureKey"/);
  });

  // Clearing on a popup opened while NOT recording is correct — there is
  // nothing to preserve, and a stale flag would arm capture for the next run.
  it("still clears capture when nothing is recording", () => {
    expect(popup).toMatch(/if \(!recording\) setCaptureState\(false\)/);
  });
});

/**
 * A refusal has to be visible where people are looking.
 *
 * The recorder blanks the value of a credential capture, so it rendered in the
 * Captured panel as a key with nothing beside it — indistinguishable from a
 * capture that read an empty string, and easy to read as "it worked". The trace
 * below already said "Capture refused"; the panel sitting next to the Stop
 * button did not.
 */
describe("a refused capture in the recorder UI", () => {
  const page = readFileSync("app/record/page.tsx", "utf8");

  it("says it was refused rather than showing an empty value", () => {
    expect(page).toMatch(/c\.sensitive \?/);
    expect(page).toMatch(/refused - credential field, no step created/);
  });

  // Both surfaces show the same events; both have to explain the same thing.
  it("agrees with the trace, which says the same", () => {
    expect(readFileSync("components/record/Trace.tsx", "utf8")).toMatch(/Capture refused/);
  });
});

/**
 * A capture you cannot watch is a capture that failed.
 *
 * The /watch wizard offers each capture as a Telegram button carrying
 * `w|f|<skillId>|<key>`, and it silently drops any button whose data exceeds
 * MAX_CB. With a 4-char prefix, a 16-char skill id and a separator, that leaves
 * 39 characters for the key — and slugKey capped at 40 while the route accepted
 * 60. A descriptively named capture simply never appeared as something you could
 * watch, with no error at any layer.
 */
describe("a capture's name has to fit the watch wizard", () => {
  it("is capped below the callback budget", async () => {
    const { OUTPUT_KEY_MAX } = await import("../lib/generalize");
    const cmds = readFileSync("lib/telegram-commands.ts", "utf8");
    const maxCb = Number(/MAX_CB = (\d+)/.exec(cmds)?.[1]);
    // "w|f|" + "skl_" + 12 hex + "|"
    const prefix = 4 + 4 + 12 + 1;
    expect(OUTPUT_KEY_MAX).toBeLessThanOrEqual(maxCb - prefix);
  });

  it("truncates a name the user typed, not just a derived one", () => {
    const src = readFileSync("lib/generalize.ts", "utf8");
    expect(src).toMatch(/\.trim\(\)\.slice\(0, OUTPUT_KEY_MAX\)/);
    expect(src).toMatch(/\.slice\(0, OUTPUT_KEY_MAX\);\s*\n\s*return k \|\| "value"/);
  });

  it("stops the name being typed past the limit in both recorders", () => {
    expect(readFileSync("app/record/page.tsx", "utf8")).toMatch(/maxLength=\{32\}/);
    expect(readFileSync("extension/popup.html", "utf8")).toMatch(/maxlength="32"/);
    expect(readFileSync("app/api/record/capture/route.ts", "utf8")).toMatch(/max\(32\)/);
  });

  // A long name produces a usable key rather than an empty one.
  it("still yields a key when the label was long", async () => {
    const { restoreCaptures, OUTPUT_KEY_MAX } = await import("../lib/generalize");
    const out = restoreCaptures(
      skill([step({ action: "navigate", selectors: ["#n"] })]),
      demo([
        { type: "navigate", selectors: ["#n"] },
        { type: "extract", selectors: ["#t"], name: "Total ".repeat(20) },
      ]),
    );
    const key = out.steps.find((s) => s.action === "extract")?.outputKey ?? "";
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(OUTPUT_KEY_MAX);
  });
});

/**
 * The editor is the front door for renaming a capture.
 *
 * Capping the key in both recorders left it open: the editor's "capture into
 * key" field had no limit and the plan schema allows 200, so renaming a capture
 * there — the normal way to do it — reintroduced exactly the bug the cap was
 * for. The capture still works, still reads its value on every run, and simply
 * never appears in /watch.
 */
describe("renaming a capture in the skill editor", () => {
  const editor = readFileSync("components/SkillEditor.tsx", "utf8");

  it("is bounded like the recorders are", () => {
    const field = editor.slice(editor.indexOf("capture into key"), editor.indexOf("capture into key") + 1200);
    expect(field).toMatch(/maxLength=\{32\}/);
  });

  /**
   * The schema stays permissive on purpose. Skills saved before this could
   * already hold a longer key, and tightening validation would refuse to save
   * them — an unwatchable capture is still a working capture, and breaking the
   * save is worse than the thing it prevents.
   */
  it("does not retroactively refuse a skill that already has a long key", () => {
    expect(readFileSync("lib/validate.ts", "utf8")).toMatch(/outputKey: z\.string\(\)\.max\(200\)/);
  });

  // maxLength stops new input without truncating an existing value, so a long
  // key can still be shortened rather than becoming uneditable.
  it("explains why, rather than silently clipping", () => {
    expect(editor).toMatch(/too long to pick in a Telegram watch/);
  });
});

describe("both recorders can ask the same question", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the site recorder offers the rule, not only the name", () => {
    // Which recorder you happened to use decided whether you could answer
    // "when do you care" at all: the extension asked, the website did not.
    const page = read("app/record/page.tsx");
    expect(page).toMatch(/aria-label="Tell me when"/);
    expect(page).toMatch(/OPS_NEEDING_VALUE\.includes\(captureOp as never\)/);
  });

  it("the rule reaches the page through the injected state", () => {
    expect(read("lib/recorder.ts")).toMatch(/__aemWatchOp = o as string/);
    expect(read("lib/recorder-inject.ts")).toMatch(/watchOp: w\.__aemWatchOp \|\| undefined/);
  });

  it("clears with the toggle, like the name", () => {
    // Otherwise the next capture silently inherits the last one's condition.
    expect(read("lib/recorder.ts")).toMatch(/this\.watchOp = on \? op : ""/);
  });

  it("the route only accepts operators the evaluator knows", () => {
    // Derived from the evaluator's own list rather than a copy of it: a copy
    // that gains an op stores rules nothing can satisfy, and one that loses an
    // op silently discards a rule somebody set while recording.
    const src = read("app/api/record/capture/route.ts");
    expect(src).toMatch(/z\.enum\(WATCH_OPS\)/);
    expect(src).toMatch(/import \{ WATCH_OPS \} from "@\/lib\/watches"/);
  });
});
