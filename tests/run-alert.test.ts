import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shouldAlert, renderRunAlert } from "../lib/run-alert-telegram";

/**
 * What earns an interruption.
 *
 * The easy version of this feature messages you about every terminal run, and
 * that is the fastest way to get the bot muted — which costs the watch alerts
 * too, since they arrive in the same chat. So the restraint is the feature, and
 * these pin it.
 */

describe("which runs are worth a message", () => {
  it("always speaks up when a run failed", () => {
    expect(shouldAlert({ status: "failed" })).toBe(true);
    expect(shouldAlert({ status: "failed", scheduleId: "sch_1" })).toBe(true);
  });

  // needs_review is waiting on a person by definition — not telling them is the
  // whole failure mode, because the run sits there until somebody looks.
  it("always speaks up when a run is waiting for you", () => {
    expect(shouldAlert({ status: "needs_review" })).toBe(true);
  });

  // You started it, you are on the page. A message adds nothing.
  it("stays quiet when you finished a run yourself", () => {
    expect(shouldAlert({ status: "completed" })).toBe(false);
  });

  it("speaks up when a completed run came from a schedule", () => {
    expect(shouldAlert({ status: "completed", scheduleId: "sch_1" })).toBe(true);
  });

  /**
   * The one that would have been a real bug. A watch run is a schedule that
   * completed, so it satisfies the rule above — and it already alerts through
   * its own rule. Without this it would send two messages for one event, and
   * the watch's message is the better one.
   */
  it("never doubles up on a watch run", () => {
    expect(shouldAlert({ status: "completed", scheduleId: "sch_1", isWatch: true })).toBe(false);
    expect(shouldAlert({ status: "failed", scheduleId: "sch_1", isWatch: true })).toBe(false);
    expect(shouldAlert({ status: "needs_review", isWatch: true })).toBe(false);
  });

  it("ignores a run still in flight", () => {
    expect(shouldAlert({ status: "running" })).toBe(false);
    expect(shouldAlert({ status: "awaiting_input" })).toBe(false);
  });
});

describe("what the message says", () => {
  it("leads with the error when one failed", () => {
    const t = renderRunAlert(
      { id: "r", status: "failed", error: "Navigation to https://x is not in the skill's allowed hosts." },
      "Nightly invoice sync",
    );
    expect(t).toContain("Run failed");
    expect(t).toContain("Nightly invoice sync");
    expect(t).toContain("allowed hosts");
  });

  it("says what a review is waiting for", () => {
    const t = renderRunAlert({ id: "r", status: "needs_review" }, "Order check");
    expect(t).toContain("Run needs you");
    expect(t).toMatch(/waiting for you/);
  });

  /**
   * Says what it captured, never the values.
   *
   * A watch can offer redaction because it has a notify object to hold the
   * setting; an ordinary schedule has none, so printing values would be a
   * decision made on the user's behalf that they cannot undo. Extension runs
   * make it concrete — they execute in the user's own signed-in browser, so a
   * logged-in page is the normal case.
   */
  it("counts what a completed run captured without printing it", () => {
    const t = renderRunAlert(
      { id: "r", status: "completed", output: { total: "$42.00", balance: "£81,204.55" } },
      "Order check",
    );
    expect(t).toContain("Captured 2 values");
    expect(t).not.toContain("$42.00");
    expect(t).not.toContain("81,204.55");
  });

  it("says one value, singular, when there is one", () => {
    const t = renderRunAlert({ id: "r", status: "completed", output: { total: "$42.00" } }, "S");
    expect(t).toContain("Captured 1 value.");
  });

  // Telegram rejects the whole send on unbalanced markdown, which turns into an
  // alert that silently never arrives — the one failure this cannot afford.
  it("escapes a skill name that would break the send", () => {
    const t = renderRunAlert({ id: "r", status: "failed", error: "x" }, "Sync *prod* _now_");
    expect(t).not.toMatch(/[^\\]\*prod\*/);
  });

  it("clips an error long enough to bury the message", () => {
    const t = renderRunAlert({ id: "r", status: "failed", error: "e".repeat(900) }, "S");
    expect(t.length).toBeLessThan(500);
  });
});

/**
 * The run that died hardest was the only one going unsaid.
 *
 * A job that exhausts its retries settles the run as failed inside the worker
 * and dispatches a webhook — it never reaches finalizeRunAccounting, which is
 * where every other terminal run gets its Telegram message. So the failure that
 * means "this did not even get through the runner" was the one failure nobody
 * was told about.
 */
describe("a run that died in the queue", () => {
  it("still excludes watch runs when the watch will speak for itself", () => {
    expect(shouldAlert({ status: "failed", isWatch: true })).toBe(false);
  });

  /**
   * …but not on the queue path. evaluateWatchForRun never ran there, so the
   * watch's failure streak has not advanced and its own "this watch is broken"
   * message will never fire. Excluding watch runs would be silence from both
   * directions, and the only symptom is a watch that quietly stops speaking.
   */
  it("speaks for a watch run when nothing else will", () => {
    expect(shouldAlert({ status: "failed", isWatch: true }, false)).toBe(true);
    expect(shouldAlert({ status: "needs_review", isWatch: true }, false)).toBe(true);
  });

  it("still says nothing about a run nobody needed to hear about", () => {
    expect(shouldAlert({ status: "completed", scheduleId: null, isWatch: true }, false)).toBe(false);
  });

  it("is wired into the worker's out-of-retries path", () => {
    const src = readFileSync("lib/worker.ts", "utf8");
    expect(src).toMatch(/alertRunFinished/);
    expect(src).toMatch(/watchWillReport: false/);
  });
});

/**
 * Every way a run can end, enumerated.
 *
 * The worker bypass was found by noticing it, not by looking systematically —
 * so this walks every writer of a terminal status and asserts each one either
 * alerts or is deliberately not terminal. A new path added later fails here
 * rather than becoming another silent failure nobody hears about.
 */
describe("no way to end a run silently", () => {
  const files = {
    "lib/run-service.ts": readFileSync("lib/run-service.ts", "utf8"),
    "lib/chain.ts": readFileSync("lib/chain.ts", "utf8"),
    "lib/worker.ts": readFileSync("lib/worker.ts", "utf8"),
    "lib/ext-run.ts": readFileSync("lib/ext-run.ts", "utf8"),
    "lib/runner.ts": readFileSync("lib/runner.ts", "utf8"),
  };

  // Each of these settles a run as failed and returns without ever reaching
  // finalizeRunAccounting, which is where the ordinary alert fires.
  it("covers the three paths that end a run before the runner sees it", () => {
    expect(files["lib/run-service.ts"]).toMatch(/Could not queue the run[\s\S]{0,300}alertRunNeverStarted/);
    expect(files["lib/chain.ts"]).toMatch(/Could not queue the chained run[\s\S]{0,300}alertRunNeverStarted/);
    expect(files["lib/worker.ts"]).toMatch(/skill removed[\s\S]{0,400}alertRunNeverStarted/);
  });

  it("covers the queue giving up after its retries", () => {
    expect(files["lib/worker.ts"]).toMatch(/attempts[\s\S]{0,2200}alertRunFinished/);
  });

  // The two paths that go through the shared accounting need nothing of their
  // own — that is where alertRunFinished already fires.
  it("leaves the shared accounting to do the rest", () => {
    expect(files["lib/run-service.ts"]).toMatch(/alertRunFinished\(final, skill\.name\)/);
    expect(files["lib/ext-run.ts"]).toMatch(/finalizeRunAccounting/);
  });

  /**
   * If a new terminal writer appears, this count moves and the test says so —
   * which is the point, since the last one to appear went unnoticed until a
   * scan happened to look at the worker.
   *
   * Comment lines are stripped first: run-service mentions finishRun() in a
   * comment explaining the crash window, and counting prose as a call gave the
   * wrong number the first time this was written.
   */
  it("knows how many places end a run", () => {
    const code = Object.values(files)
      .join("\n")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    const finishes = code.match(/await finishRun\(/g) ?? [];
    expect(finishes).toHaveLength(6);
  });
});
