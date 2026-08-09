import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { branchSpan, conditionSentence, MAX_BRANCH_SPAN } from "../../lib/watches";
import { conditionMet } from "../../lib/branch";
import type { StepCondition } from "../../lib/types";

/**
 * Branching, against a real DOM.
 *
 * A condition used to ask one question — is this on the page — about one step.
 * It now asks what the element SAYS, in the vocabulary a wait and a watch rule
 * already use, and it can govern a group so "if it is already approved, skip
 * these four" is one decision in one place rather than the same test copied
 * onto four steps that then have to be kept in agreement by hand.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * The runner's own decision, run against the live page.
 *
 * Imported rather than reimplemented: a test that copies the logic it is
 * checking only ever proves the copy right.
 */
const met = (cond: StepCondition) => conditionMet(page, cond);

describe("a condition can ask what the element says", () => {
  it("compares a number on the page", async () => {
    await page.setContent(`<div id="total">$1,249.00</div>`);
    expect(await met({ kind: "exists", selector: "#total", op: "above", value: "100" })).toBe(true);
    expect(await met({ kind: "exists", selector: "#total", op: "below", value: "100" })).toBe(false);
  });

  it("compares its text", async () => {
    await page.setContent(`<div id="status">Approved</div>`);
    expect(await met({ kind: "exists", selector: "#status", op: "equals", value: "Approved" })).toBe(true);
    expect(await met({ kind: "exists", selector: "#status", op: "contains", value: "prove" })).toBe(true);
    expect(await met({ kind: "exists", selector: "#status", op: "not_contains", value: "Rejected" })).toBe(true);
  });

  it("reads a form field by its value", async () => {
    await page.setContent(`<input id="amount" value="42">`);
    expect(await met({ kind: "exists", selector: "#amount", op: "above", value: "40" })).toBe(true);
  });

  it("does not run on a reading it could not make", async () => {
    // A branch that cannot be judged must not take the path that DOES
    // something on the strength of not knowing.
    await page.setContent(`<div id="total">still loading</div>`);
    expect(await met({ kind: "exists", selector: "#total", op: "above", value: "100" })).toBe(false);
    expect(await met({ kind: "exists", selector: "#missing", op: "contains", value: "x" })).toBe(false);
  });

  it("ignores an element that is hidden", async () => {
    await page.setContent(`<div id="banner" style="display:none">Approved</div>`);
    expect(await met({ kind: "exists", selector: "#banner", op: "equals", value: "Approved" })).toBe(false);
  });

  it("still answers the old presence question when no operator is set", async () => {
    await page.setContent(`<div id="cookie">accept?</div>`);
    expect(await met({ kind: "exists", selector: "#cookie" })).toBe(true);
    expect(await met({ kind: "absent", selector: "#cookie" })).toBe(false);
    expect(await met({ kind: "absent", selector: "#nope" })).toBe(true);
    // Presence, not visibility — unchanged from what it has always meant.
    await page.setContent(`<div id="cookie" style="display:none">accept?</div>`);
    expect(await met({ kind: "exists", selector: "#cookie" })).toBe(true);
  });
});

/** The runner's group-skipping rule, in isolation. */
function walk(
  plan: { pos: number; cond?: { met: boolean; span?: number } }[],
): { ran: number[]; skipped: number[] } {
  const ran: number[] = [];
  const skipped: number[] = [];
  let skipThrough = -1;
  for (const s of plan) {
    if (s.pos <= skipThrough) {
      // A skipped step that is itself a branch takes its own group with it.
      if (s.cond) skipThrough = Math.max(skipThrough, s.pos + branchSpan({ span: s.cond.span }) - 1);
      skipped.push(s.pos);
      continue;
    }
    if (s.cond && !s.cond.met) {
      const span = Math.max(1, Math.min(50, Math.floor(s.cond.span ?? 1)));
      skipThrough = s.pos + span - 1;
      skipped.push(s.pos);
      continue;
    }
    ran.push(s.pos);
  }
  return { ran, skipped };
}

describe("a branch that governs a group", () => {
  it("skips itself and everything it covers", () => {
    const r = walk([
      { pos: 0 },
      { pos: 1, cond: { met: false, span: 3 } },
      { pos: 2 },
      { pos: 3 },
      { pos: 4 },
    ]);
    expect(r.ran).toEqual([0, 4]);
    expect(r.skipped).toEqual([1, 2, 3]);
  });

  it("runs the group when it holds", () => {
    const r = walk([
      { pos: 0, cond: { met: true, span: 3 } },
      { pos: 1 },
      { pos: 2 },
      { pos: 3 },
    ]);
    expect(r.ran).toEqual([0, 1, 2, 3]);
  });

  it("keeps the old one-step behaviour when nothing says otherwise", () => {
    const r = walk([{ pos: 0, cond: { met: false } }, { pos: 1 }]);
    expect(r.ran).toEqual([1]);
    expect(r.skipped).toEqual([0]);
  });

  it("nests: an inner branch is only asked when the outer one ran", () => {
    // The second level. An inner condition inside a skipped group is never
    // evaluated, which is what makes containment the nesting rule.
    const outerRuns = walk([
      { pos: 0, cond: { met: true, span: 3 } },
      { pos: 1, cond: { met: false, span: 2 } },
      { pos: 2 },
      { pos: 3 },
    ]);
    expect(outerRuns.ran).toEqual([0, 3]);
    expect(outerRuns.skipped).toEqual([1, 2]);

    const outerSkips = walk([
      { pos: 0, cond: { met: false, span: 3 } },
      { pos: 1, cond: { met: true, span: 2 } },
      { pos: 2 },
      { pos: 3 },
    ]);
    expect(outerSkips.ran).toEqual([3]);
  });

  it("a span past the end of the plan covers what is left, not more", () => {
    const r = walk([{ pos: 0 }, { pos: 1, cond: { met: false, span: 50 } }, { pos: 2 }]);
    expect(r.ran).toEqual([0]);
    expect(r.skipped).toEqual([1, 2]);
  });
});

describe("one clamp, three readers", () => {
  it("a span that says nothing coherent means this step only", () => {
    // The safe reading of an incoherent number is the behaviour a condition has
    // always had, not a branch that swallows the rest of the plan.
    expect(branchSpan(undefined)).toBe(1);
    expect(branchSpan({})).toBe(1);
    expect(branchSpan({ span: 0 })).toBe(1);
    expect(branchSpan({ span: -4 })).toBe(1);
    expect(branchSpan({ span: 2.7 })).toBe(2);
    expect(branchSpan({ span: 5 })).toBe(5);
    expect(branchSpan({ span: 9999 })).toBe(50);
  });

  it("the runner uses it rather than its own arithmetic", () => {
    const src = readFileSync("lib/runner.ts", "utf8");
    expect(src).toMatch(/const span = branchSpan\(step\.condition\)/);
    expect(src).toMatch(/skipThrough = Math\.max\(skipThrough, pos \+ branchSpan\(step\.condition\) - 1\)/);
    // And a step inside a skipped group never reaches its own condition.
    const at = src.indexOf("if (pos <= skipThrough)");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf("if (step.condition && !(await conditionMet("));
  });

  it("the extension's driver honours conditions at all, and the same way", () => {
    // It used to have none: a conditional step ran unconditionally there while
    // the cloud skipped it, so the same skill did different work depending on
    // where it ran.
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg).toMatch(/if \(i <= skipThrough\)/);
    expect(bg).toMatch(/skipThrough = Math\.max\(skipThrough, i \+ branchSpan\(step\.condition\) - 1\)/);
    expect(bg).toMatch(/askCondition\(tabId, step\.condition\)/);
    // No answer from the page is not permission to run.
    expect(bg).toMatch(/resolve\(chrome\.runtime\.lastError \? false : !!\(resp && resp\.met\)\)/);
  });

  it("and the extension judges it with the same reader and vocabulary", () => {
    const ext = readFileSync("extension/content.js", "utf8");
    const fn = ext.slice(ext.indexOf("function conditionMet(cond)"), ext.indexOf("function performStep("));
    expect(fn).toMatch(/found && aemVisible\(found\) \? found : null/);
    expect(fn).toMatch(/aemHolds\(cond\.op, cond\.value \|\| "", el \? readValue\(el, 20000\) : null\) === true/);
  });
});

/** The editor's rule for removing a step, applied to a plan. */
function removeAt<T extends { condition?: { span?: number } }>(steps: T[], i: number): T[] {
  return steps
    .map((x, j) => {
      const span = x.condition?.span ?? 1;
      const covers = j < i && i <= j + span - 1;
      return covers ? { ...x, condition: { ...x.condition!, span: Math.max(1, span - 1) } } : x;
    })
    .filter((_, j) => j !== i);
}

describe("editing the plan around a branch", () => {
  const plan = () => [
    { id: "a" },
    { id: "b", condition: { kind: "exists", selector: "#x", span: 3 } },
    { id: "c" },
    { id: "d" },
    { id: "e" },
  ];

  it("shrinks a branch when a step inside it is removed", () => {
    // The span is a COUNT. Left alone it points one step further down the plan
    // and quietly governs a step that was never meant to be conditional.
    const after = removeAt(plan(), 2); // remove "c", which the branch covers
    expect(after.map((s) => s.id)).toEqual(["a", "b", "d", "e"]);
    expect(after[1].condition!.span).toBe(2); // now covers b and d only
  });

  it("leaves a branch alone when the removed step is outside it", () => {
    const after = removeAt(plan(), 4); // remove "e", past the group
    expect(after[1].condition!.span).toBe(3);
    const before = removeAt(plan(), 0); // remove "a", before the group
    expect(before[0].condition!.span).toBe(3);
  });

  it("removing the branch's own step takes the condition with it", () => {
    const after = removeAt(plan(), 1);
    expect(after.map((s) => s.id)).toEqual(["a", "c", "d", "e"]);
    expect(after.every((s) => !s.condition)).toBe(true);
  });

  it("never shrinks below covering itself", () => {
    const one = [{ id: "a", condition: { kind: "exists", selector: "#x", span: 2 } }, { id: "b" }];
    const after = removeAt(one, 1);
    expect(after[0].condition!.span).toBe(1);
  });

  it("the editor applies it on remove", () => {
    const ed = readFileSync("components/SkillEditor.tsx", "utf8");
    const fn = ed.slice(ed.indexOf("function removeStep(i: number)"), ed.indexOf("async function save()"));
    expect(fn).toMatch(/const covers = j < i && i <= j \+ span - 1/);
    expect(fn).toMatch(/span: Math\.max\(1, span - 1\)/);
  });
});

describe("a branch with nothing to check", () => {
  it("is refused where it is set", () => {
    // An empty selector throws in both runners, which reads as "not met" — so
    // the step and everything its branch covers is skipped on every run,
    // forever, with nothing anywhere saying why.
    const v = readFileSync("lib/validate.ts", "utf8");
    const cond = v.slice(v.indexOf("  condition: z"), v.indexOf("  condition: z") + 900);
    expect(cond).toMatch(/selector: z\.string\(\)\.min\(1\)\.max\(2000\)/);
  });

  it("says so before the save refuses it", () => {
    const ed = readFileSync("components/SkillEditor.tsx", "utf8");
    expect(ed).toMatch(/A branch needs something to check/);
    expect(ed).toMatch(/!s\.condition\.selector\.trim\(\)/);
  });

  it("and an unreadable selector is not permission to run", async () => {
    await page.setContent(`<div id="real">here</div>`);
    expect(await met({ kind: "exists", selector: "<<<nonsense" })).toBe(false);
    expect(await met({ kind: "exists", selector: "<<<nonsense", op: "appears" })).toBe(false);
  });
});

describe("the extension clamps a span the same way", () => {
  it("uses the same ceiling as the library", () => {
    // A separate bundle, so this is a copy. A copy that drifts means the same
    // plan governs a different number of steps depending on where it ran.
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg).toMatch(/return Math\.min\(50, n\)/);
    expect(MAX_BRANCH_SPAN).toBe(50);
  });
});

describe("a reviewer skipping a branch", () => {
  it("takes the group with it", () => {
    // The gate was never evaluated. Running gated work without ever asking its
    // question is the dangerous half of the two readings — that is how an
    // invoice that was already filed gets filed again.
    const src = readFileSync("lib/runner.ts", "utf8");
    const block = src.slice(
      src.indexOf("// Reviewer chose to skip this step."),
      src.indexOf("// Inside a branch that did not run."),
    );
    expect(block).toMatch(/await skipStep\(/);
    expect(block).toMatch(/Skipped by reviewer, and the steps this branch covers\./);
  });

  it("still happens before the group check, so the record says who skipped it", () => {
    const src = readFileSync("lib/runner.ts", "utf8");
    expect(src.indexOf("if (override?.skip)")).toBeLessThan(src.indexOf("if (pos <= skipThrough)"));
  });
});

describe("what a stranger is told the skill does", () => {
  it("the marketplace marks a conditional step and what it covers", () => {
    // The page is headed "What it does". A plan listed flat says every step
    // happens; when four are behind a branch, that is an overstatement of the
    // skill on the one page whose job is describing it.
    const page = readFileSync("app/market/[id]/page.tsx", "utf8");
    expect(page).toMatch(/conditionSentence\(s\.condition\)/);
    expect(page).toMatch(/covers \$\{span\} steps/);
    expect(page).toMatch(/in the branch above/);
  });

  it("works out the covered steps without mutating during render", () => {
    const page = readFileSync("app/market/[id]/page.tsx", "utf8");
    const pre = page.slice(page.indexOf("const branchCover: boolean[]"), page.indexOf("  return ("));
    expect(pre).toMatch(/through = pos \+ branchSpan\(s\.condition\) - 1/);
  });

  it("the sentence is the one the runner records", () => {
    // One wording, so the reason a step was skipped in a receipt reads the same
    // as the reason the marketplace gave for it being conditional.
    // The runner records it; lib/branch decides it; the marketplace prints it.
    expect(readFileSync("lib/runner.ts", "utf8")).toMatch(/conditionSentence\(step\.condition\)/);
    expect(readFileSync("app/market/[id]/page.tsx", "utf8")).toMatch(/conditionSentence\(s\.condition\)/);
    expect(conditionSentence({ kind: "exists", selector: "#x" })).toBe('only if "#x" is present');
    expect(conditionSentence({ kind: "absent", selector: "#x" })).toBe('only if "#x" is absent');
    expect(conditionSentence({ selector: "#t", op: "above", value: "100" })).toBe(
      'only if "#t" is above 100',
    );
    expect(conditionSentence({ selector: "#b", op: "disappears" })).toBe(
      'only if "#b" shows nothing',
    );
  });
});

describe("seeing a branch while you build it", () => {
  const ed = readFileSync("components/SkillEditor.tsx", "utf8");

  it("marks the steps a branch covers", () => {
    // A span is a number: "this step and the next 3" says how many and never
    // which. Choosing a branch whose extent you cannot see is how one ends up
    // covering a step nobody meant it to.
    expect(ed).toMatch(/branchCover\[i\] \? "ml-6 border-l-2/);
    expect(ed).toMatch(/in branch/);
  });

  it("computes it before the list, not through it", () => {
    const pre = ed.slice(ed.indexOf("const branchCover: boolean[]"), ed.indexOf("  return ("));
    expect(pre).toMatch(/through = pos \+ branchSpan\(s\.condition\) - 1/);
  });

  it("uses the same clamp as the runner when a step is removed", () => {
    // Otherwise a stored span the runner caps at 50 is treated here as whatever
    // number it happens to be.
    const fn = ed.slice(ed.indexOf("function removeStep(i: number)"), ed.indexOf("async function save()"));
    expect(fn).toMatch(/const span = branchSpan\(x\.condition\)/);
  });
});

describe("branches whose spans overlap instead of nesting", () => {
  it("a skipped branch head does not leave its own group ungated", () => {
    // A at 0 covering three steps, B at 2 covering three more. A fails, so B's
    // head is skipped — and the steps B gates sit outside A's range, so they
    // used to run with their gate never evaluated. Same hazard as a reviewer
    // skipping a branch head.
    const r = walk([
      { pos: 0, cond: { met: false, span: 3 } },
      { pos: 1 },
      { pos: 2, cond: { met: true, span: 3 } },
      { pos: 3 },
      { pos: 4 },
      { pos: 5 },
    ]);
    expect(r.skipped).toEqual([0, 1, 2, 3, 4]);
    expect(r.ran).toEqual([5]);
  });

  it("changes nothing when the spans nest cleanly", () => {
    const r = walk([
      { pos: 0, cond: { met: false, span: 4 } },
      { pos: 1, cond: { met: true, span: 2 } },
      { pos: 2 },
      { pos: 3 },
      { pos: 4 },
    ]);
    expect(r.skipped).toEqual([0, 1, 2, 3]);
    expect(r.ran).toEqual([4]);
  });

  it("both runners extend the skip the same way", () => {
    const src = readFileSync("lib/runner.ts", "utf8");
    expect(src).toMatch(
      /skipThrough = Math\.max\(skipThrough, pos \+ branchSpan\(step\.condition\) - 1\)/,
    );
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg).toMatch(/skipThrough = Math\.max\(skipThrough, i \+ branchSpan\(step\.condition\) - 1\)/);
  });
});

describe("one place a step is skipped", () => {
  it("the runner has a single skip path, not three", () => {
    // The invariant — a skipped step that is itself a branch takes its group
    // with it — went in twice through two different doors before it lived in
    // one place. A fourth way in cannot get it wrong now.
    const src = readFileSync("lib/runner.ts", "utf8");
    const fn = src.slice(src.indexOf("const skipStep = async (reason: string)"), src.indexOf("        // Reviewer chose to skip this step."));
    expect(fn).toMatch(/skipThrough = Math\.max\(skipThrough, pos \+ branchSpan\(step\.condition\) - 1\)/);
    expect(fn).toMatch(/await recordStep\(runId, step, "", recVal, recShot, 1, false, reason\)/);
    // Every skip goes through it.
    expect(src.match(/await skipStep\(/g) ?? []).toHaveLength(3);
    expect(src).not.toMatch(/if \(step\.condition\) skipThrough = pos \+ branchSpan/);
  });

  it("the extension has one too, and the same clamp", () => {
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg.match(/await skipStep\(/g) ?? []).toHaveLength(2);
    const fn = bg.slice(bg.indexOf("function branchSpan(cond)"), bg.indexOf("function askCondition"));
    expect(fn).toMatch(/if \(!Number\.isFinite\(n\) \|\| n < 1\) return 1/);
    expect(fn).toMatch(/return Math\.min\(50, n\)/);
    expect(MAX_BRANCH_SPAN).toBe(50);
  });

  it("a skipped secret step still redacts its value and screenshot", () => {
    // The one thing the consolidation must not lose: a conditional SECRET input
    // whose branch does not run must not persist the resolved credential into
    // the step record, which is shown unmasked and folded into the receipt.
    const src = readFileSync("lib/runner.ts", "utf8");
    const fn = src.slice(src.indexOf("const skipStep = async (reason: string)"), src.indexOf("        // Reviewer chose to skip this step."));
    expect(fn).toMatch(/recVal, recShot/);
    expect(fn).toMatch(/await snap\(\)/);
  });
});

describe("what the popup says while a branch is skipped", () => {
  it("does not announce a step it is about to skip", () => {
    // The one place this driver tells a person what it is doing right now. It
    // named the step as running and then skipped it.
    const bg = readFileSync("extension/background.js", "utf8");
    const at = bg.indexOf('await setStatus({ state: "running"');
    expect(at).toBeGreaterThan(bg.indexOf("if (i <= skipThrough)"));
    expect(at).toBeGreaterThan(bg.indexOf("await askCondition(tabId, step.condition)"));
  });
});

describe("edges the real decision has to answer", () => {
  it("judges the first match when a selector hits several", async () => {
    // Same rule the wait uses: one element, resolved the way every other step
    // resolves one. Judging "any of them" would let a stale row two screens
    // down decide whether the branch runs.
    await page.setContent(`<div class="s">pending</div><div class="s">Approved</div>`);
    expect(await met({ kind: "exists", selector: ".s", op: "equals", value: "pending" })).toBe(true);
    expect(await met({ kind: "exists", selector: ".s", op: "equals", value: "Approved" })).toBe(false);
  });

  it("an element that is there and says nothing", async () => {
    await page.setContent(`<div id="t"></div>`);
    expect(await met({ kind: "exists", selector: "#t", op: "appears" })).toBe(false);
    expect(await met({ kind: "exists", selector: "#t", op: "disappears" })).toBe(true);
    // Presence is a different question, and still answers yes.
    expect(await met({ kind: "exists", selector: "#t" })).toBe(true);
  });

  it("survives the page changing under it", async () => {
    await page.setContent(`<div id="t">here</div>`);
    expect(await met({ kind: "exists", selector: "#t", op: "appears" })).toBe(true);
    await page.setContent(`<p>something else entirely</p>`);
    expect(await met({ kind: "exists", selector: "#t", op: "appears" })).toBe(false);
    expect(await met({ kind: "exists", selector: "#t" })).toBe(false);
  });

  it("reads a select by its chosen value", async () => {
    await page.setContent(
      `<select id="c"><option value="draft">draft</option><option value="final" selected>final</option></select>`,
    );
    expect(await met({ kind: "exists", selector: "#c", op: "equals", value: "final" })).toBe(true);
  });
});

describe("a branch nested inside another", () => {
  it("the marketplace still shows the inner condition", () => {
    // Marking it only as "in the branch above" hides the inner test entirely,
    // and a nested condition is part of what the skill does — on the page whose
    // heading is what it does.
    const page = readFileSync("app/market/[id]/page.tsx", "utf8");
    const list = page.slice(page.indexOf("{skill.plan.map((s, pos) =>"));
    expect(list).not.toMatch(/s\.condition && !covered/);
    expect(list).toMatch(/\{s\.condition && \(/);
    // And it is still marked as governed by the branch above it.
    expect(list).toMatch(/in the branch above/);
  });

  it("both markers can appear on the same step", () => {
    const page = readFileSync("app/market/[id]/page.tsx", "utf8");
    const list = page.slice(page.indexOf("{skill.plan.map((s, pos) =>"));
    const condAt = list.indexOf("{s.condition && (");
    const coveredAt = list.indexOf("{covered && (");
    expect(condAt).toBeGreaterThan(0);
    expect(coveredAt).toBeGreaterThan(condAt);
  });
});

describe("when the browser dies mid-run", () => {
  it("a branch says so instead of answering false", async () => {
    // Answering false would skip the step AND everything its group covers, for
    // every remaining branch — a run that did nothing finishing as COMPLETED.
    // The step-level catch fails a run properly; the error has to reach it.
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    await p.setContent(`<div id="t">here</div>`);
    expect(await conditionMet(p, { kind: "exists", selector: "#t", op: "appears" })).toBe(true);
    await p.close();
    await expect(conditionMet(p, { kind: "exists", selector: "#t", op: "appears" })).rejects.toThrow();
    await expect(conditionMet(p, { kind: "exists", selector: "#t" })).rejects.toThrow();
    await b.close();
  });

  it("an unusable selector on a live page still answers false", async () => {
    // The distinction that matters: not-on-the-page is a real answer, a dead
    // browser is not.
    await page.setContent(`<div id="t">here</div>`);
    expect(await met({ kind: "exists", selector: "<<<nonsense" })).toBe(false);
    expect(await met({ kind: "exists", selector: "#nope", op: "appears" })).toBe(false);
  });
});

describe("an unreachable page, on both runners", () => {
  it("the check lives in one place now", () => {
    const shared = readFileSync("lib/page-read.ts", "utf8");
    expect(shared).toMatch(/export function pageIsGone\(page: Page, e: unknown\): boolean/);
    for (const f of ["lib/branch.ts", "lib/wait.ts"]) {
      expect(readFileSync(f, "utf8")).toMatch(/pageIsGone \} from "\.\/page-read"|, pageIsGone \} from "\.\/page-read"/);
      expect(readFileSync(f, "utf8")).toMatch(/if \(pageIsGone\(page, e\)\) throw e/);
    }
  });

  it("the extension fails the run rather than calling it a condition that did not hold", () => {
    // Treated as "not met", a closed tab skips this step and everything its
    // branch covers — then the next branch, and the next — so a run that did
    // nothing finishes saying it was fine.
    const bg = readFileSync("extension/background.js", "utf8");
    expect(bg).toMatch(/if \(!\(await ensureReady\(tabId, 15000\)\)\) \{/);
    const block = bg.slice(bg.indexOf("if (!(await ensureReady(tabId, 15000))) {"));
    expect(block.slice(0, 600)).toMatch(/status = "needs_review"/);
    expect(block.slice(0, 600)).toMatch(/Could not reach the page to check this step's condition/);
  });
});

describe("the span control tells the truth about a stored value", () => {
  it("always offers the value the step actually has", () => {
    // The API accepts any span up to 50; the dropdown offered a fixed list. A
    // stored 7 matched nothing, so the select drew "this step only" while the
    // list beside it marked seven steps as covered — two displays contradicting
    // each other about the same branch.
    const ed = readFileSync("components/SkillEditor.tsx", "utf8");
    expect(ed).toMatch(/new Set\(\[1, 2, 3, 4, 5, 6, 8, 10, 15, 20, branchSpan\(s\.condition\)\]\)/);
    expect(ed).toMatch(/\.sort\(\(a, b\) => a - b\)/);
  });

  it("and the value it offers is the one the runner would use", () => {
    // branchSpan, not the raw number: a stored 9999 is 50 to the runner, and
    // showing 9999 here would be a third answer.
    expect(branchSpan({ span: 9999 })).toBe(MAX_BRANCH_SPAN);
    expect(branchSpan({ span: 7 })).toBe(7);
  });
});
