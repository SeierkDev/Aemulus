import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
import { createRun, finishRun, setRunOutcome } from "../../lib/runs";
import { attachReceipt, verifyReceipt } from "../../lib/receipt";
import { createSkill } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

const gen = (): GeneralizedSkill => ({
  name: "RC",
  description: "",
  inputFields: [],
  steps: [{ intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" }],
});

beforeAll(async () => {
  await ready();
});

describe("receipt hash covers the outcome verdict / result / error", () => {
  it("tampering the anchored outcome verdict fails verification", async () => {
    const skill = await createSkill({ owner: "RC_OWNER", generalized: gen(), sourceDemoId: null });
    const run = await createRun({ owner: "RC_OWNER", skillId: skill.id, input: {} });
    await finishRun(run.id, { status: "completed", result: "ok", error: null });
    await setRunOutcome(run.id, "unconfirmed", "screen didn't confirm the goal");
    await attachReceipt(run.id); // now folds outcome + result/error into the hash

    expect((await verifyReceipt(run.id)).matches).toBe(true);

    // Flip the "achieved" trust signal directly in the DB (a tamper the old hash,
    // which only covered status, would NOT have detected).
    await db.execute({ sql: `UPDATE runs SET outcome_status = 'achieved' WHERE id = ?`, args: [run.id] });
    expect((await verifyReceipt(run.id)).matches).toBe(false);
  });

  it("tampering the result also fails verification", async () => {
    const skill = await createSkill({ owner: "RC_OWNER", generalized: gen(), sourceDemoId: null });
    const run = await createRun({ owner: "RC_OWNER", skillId: skill.id, input: {} });
    await finishRun(run.id, { status: "completed", result: "original", error: null });
    await attachReceipt(run.id);
    expect((await verifyReceipt(run.id)).matches).toBe(true);

    await db.execute({ sql: `UPDATE runs SET result = 'tampered' WHERE id = ?`, args: [run.id] });
    expect((await verifyReceipt(run.id)).matches).toBe(false);
  });
});
