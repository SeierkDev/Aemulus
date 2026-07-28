import { beforeAll, describe, expect, it, vi } from "vitest";

// Stub ONLY the browser executor so the real run-completion path (bookkeeping,
// receipt, earnings, reputation, anchors) runs end-to-end without a live browser.
// The executor stands in for a real run: mark it completed + attach a real,
// verifiable receipt, exactly as executeRun does.
vi.mock("../../lib/runner", async (orig) => {
  const actual = await orig<typeof import("../../lib/runner")>();
  return {
    ...actual,
    executeRun: vi.fn(async (_skill: unknown, runId: string) => {
      const { finishRun, getRun } = await import("../../lib/runs");
      const { attachReceipt } = await import("../../lib/receipt");
      await finishRun(runId, { status: "completed", result: "ok", error: null });
      await attachReceipt(runId);
      return (await getRun(runId))!;
    }),
  };
});

import { ready } from "../../lib/db";
import {
  createSkill,
  setPublished,
  listPublishedSkills,
  searchPublishedSkills,
} from "../../lib/skills";
import { startRun, completeRun } from "../../lib/run-service";
import { getRun, hasRunSkill } from "../../lib/runs";
import { verifyReceipt } from "../../lib/receipt";
import { getClaimable } from "../../lib/earnings";
import { getSkillReputation, rateSkill } from "../../lib/reputation";
import { SOLANA } from "../../lib/solana";
import type { GeneralizedSkill } from "../../lib/types";

const CREATOR = "WALLET_E2E_CREATOR";
const RUNNER = "WALLET_E2E_RUNNER";

function gen(): GeneralizedSkill {
  return {
    name: "E2E Marketplace Skill",
    description: "an end-to-end smoke skill",
    inputFields: [{ key: "q", label: "Query", example: "x" }],
    steps: [{ intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" }],
  };
}

beforeAll(async () => {
  await ready();
});

describe("end-to-end: publish → run → receipt → verify → earn → rate", () => {
  it("stitches the full flow across modules", async () => {
    // ── create + publish ────────────────────────────────────────────────────
    const skill = await createSkill({ owner: CREATOR, generalized: gen(), sourceDemoId: null });
    expect(skill.published).toBeFalsy();
    expect(await setPublished(skill.id, CREATOR, true)).toBe(true);

    // it's live in the marketplace (list + search)
    expect((await listPublishedSkills()).some((s) => s.id === skill.id)).toBe(true);
    expect((await searchPublishedSkills("Marketplace")).some((s) => s.id === skill.id)).toBe(true);

    // ── an EXTERNAL wallet runs it (start → worker/completeRun) ──────────────
    expect(await hasRunSkill(RUNNER, skill.id)).toBe(false);
    const run = await startRun({ skill, input: { q: "hello" }, runner: RUNNER });
    expect((await getRun(run.id))!.status).toBe("running");
    await completeRun(run.id, { skill, input: { q: "hello" }, runner: RUNNER });

    // ── completed + a verifiable on-chain-style receipt ─────────────────────
    const done = await getRun(run.id);
    expect(done!.status).toBe("completed");
    const v = await verifyReceipt(run.id);
    expect(v.found).toBe(true);
    expect(v.matches).toBe(true);

    // ── bookkeeping fired exactly once: run_count, creator credit, reputation ─
    expect(await hasRunSkill(RUNNER, skill.id)).toBe(true);
    const rep = await getSkillReputation(skill.id);
    expect(rep.runs).toBe(1);
    expect(rep.completed).toBe(1);
    expect(rep.successRate).toBe(1);
    expect(await getClaimable(CREATOR)).toBe(SOLANA.runFee); // creator paid the run fee

    // ── a SECOND run by the same runner: run counts, but credit is once-only ──
    const run2 = await startRun({ skill, input: { q: "again" }, runner: RUNNER });
    await completeRun(run2.id, { skill, input: { q: "again" }, runner: RUNNER });
    expect((await getSkillReputation(skill.id)).runs).toBe(2);
    expect(await getClaimable(CREATOR)).toBe(SOLANA.runFee); // still once (anti-Sybil)

    // ── the runner rates it → stars flow into reputation ────────────────────
    await rateSkill({ skillId: skill.id, rater: RUNNER, stars: 5, comment: "worked" });
    const rated = await getSkillReputation(skill.id);
    expect(rated.avgStars).toBe(5);
    expect(rated.ratingCount).toBe(1);
  });

  it("does not credit the creator for their OWN run", async () => {
    const skill = await createSkill({ owner: CREATOR, generalized: gen(), sourceDemoId: null });
    const before = await getClaimable(CREATOR);
    const run = await startRun({ skill, input: {}, runner: CREATOR }); // owner runs their own skill
    await completeRun(run.id, { skill, input: {}, runner: CREATOR });
    expect((await getRun(run.id))!.status).toBe("completed");
    // owner run: no self-credit, and it counts toward NEITHER marketplace popularity
    // (run_count) NOR the public reputation "runs · success" signal — otherwise an
    // owner could self-inflate the trust signal by re-running their own skill.
    expect(await getClaimable(CREATOR)).toBe(before);
    expect((await getSkillReputation(skill.id)).runs).toBe(0); // owner runs excluded from reputation
  });
});
