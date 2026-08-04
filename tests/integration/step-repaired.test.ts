import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { addRunStep, getRun, createRun } from "../../lib/runs";
import { createSkill } from "../../lib/skills";
import { id } from "../../lib/ids";
import type { GeneralizedSkill, Skill } from "../../lib/types";

/**
 * A repair has to survive the round trip.
 *
 * The runner already wrote a human-readable note when the agent rescued a step,
 * and a note is the wrong thing to build a UI on: it is prose, written for a
 * person, and a page that wants to say "this step was repaired" would have to
 * pattern-match English to find out. So it is a column.
 *
 * It matters beyond the badge. A published skill that quietly needed repairing
 * is a skill whose page has moved, and the author is the only one who can fix
 * it properly — that is only actionable if the fact is stored rather than
 * phrased.
 */

let skill: Skill;

describe("a repaired step", () => {
  let runId = "";

  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: "w_rep",
      generalized: { name: "R", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
    const run = await createRun({
      owner: "w_rep",
      skillId: skill.id,
      runner: "w_rep",
      input: {},
    } as never);
    runId = run!.id;
  });

  it("is stored, not inferred from the note", async () => {
    await addRunStep({
      id: id("rst"),
      runId,
      idx: 0,
      intent: "Click continue",
      action: "click",
      selectorUsed: "button.next",
      value: "",
      screenshot: "",
      confidence: 0.7,
      flagged: false,
      note: "The recorded selector missed; the agent found the button.",
      repaired: true,
      createdAt: Date.now(),
    });

    const run = await getRun(runId);
    expect(run!.steps[0].repaired).toBe(true);
  });

  // The default has to be false rather than undefined, or every step written
  // before this column existed would read as ambiguous instead of "not
  // repaired" — and the badge would be deciding on a missing value.
  it("defaults to false for a step that ran normally", async () => {
    await addRunStep({
      id: id("rst"),
      runId,
      idx: 1,
      intent: "Read the total",
      action: "extract",
      selectorUsed: ".total",
      value: "$42.00",
      screenshot: "",
      confidence: 1,
      flagged: false,
      note: "",
      createdAt: Date.now(),
    });

    const run = await getRun(runId);
    expect(run!.steps[1].repaired).toBe(false);
  });
});
