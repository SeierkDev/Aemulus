import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ready } from "../../lib/db";
import { createSkill, updateSkill, setSkillOrg } from "../../lib/skills";
import { createOrg, addMember } from "../../lib/orgs";
import { getRun } from "../../lib/runs";
import { startChainedRun, childInput, planHasChaining } from "../../lib/chain";
import type { GeneralizedSkill, SkillStep } from "../../lib/types";

const OWNER = "CHAIN_O";
const gen = (name: string, fields: { key: string; label: string; example: string }[] = []): GeneralizedSkill => ({
  name,
  description: "",
  inputFields: fields,
  steps: [],
});

beforeAll(async () => {
  await ready();
});

describe("childInput mapping", () => {
  it("fills child fields from parent outputs first, then parent input", () => {
    const fields = [
      { key: "email", label: "Email", example: "" },
      { key: "name", label: "Name", example: "" },
      { key: "missing", label: "M", example: "" },
    ];
    const mapped = childInput(fields, { name: "Ann", email: "in@x.com" }, { email: "out@x.com" });
    expect(mapped).toEqual({ email: "out@x.com", name: "Ann" }); // output wins; missing omitted
  });
});

describe("startChainedRun", () => {
  it("starts a child run of the sub-skill with mapped input", async () => {
    const parent = await createSkill({ owner: OWNER, generalized: gen("Parent"), sourceDemoId: null });
    const sub = await createSkill({
      owner: OWNER,
      generalized: gen("Sub", [{ key: "email", label: "Email", example: "" }]),
      sourceDemoId: null,
    });
    const res = await startChainedRun({
      parentSkillId: parent.id,
      subSkillId: sub.id,
      owner: OWNER,
      parentInput: {},
      parentOutputs: { email: "captured@x.com" },
    });
    expect("runId" in res).toBe(true);
    if ("runId" in res) {
      const child = await getRun(res.runId);
      expect(child!.skillId).toBe(sub.id);
      expect(child!.input).toEqual({ email: "captured@x.com" });
    }
  });

  it("refuses self-chaining, unknown skills, and nested chains", async () => {
    const a = await createSkill({ owner: OWNER, generalized: gen("A"), sourceDemoId: null });
    expect(await startChainedRun({ parentSkillId: a.id, subSkillId: a.id, owner: OWNER, parentInput: {}, parentOutputs: {} })).toEqual({ skipped: "a skill can't chain to itself" });
    expect(await startChainedRun({ parentSkillId: a.id, subSkillId: "skl_nope", owner: OWNER, parentInput: {}, parentOutputs: {} })).toEqual({ skipped: "sub-skill not found" });

    // a sub-skill that itself chains -> nested, refused
    const nested = await createSkill({ owner: OWNER, generalized: gen("Nested"), sourceDemoId: null });
    const chainStep: SkillStep = {
      idx: 0, intent: "chain", action: "run_skill", selectors: [], target: "",
      valueSource: "none", value: "", inputKey: "", key: "", subSkillId: a.id,
    };
    await updateSkill(nested.id, { name: "Nested", description: "", plan: [chainStep], inputSchema: { fields: [] } });
    expect(planHasChaining([chainStep])).toBe(true);
    expect(await startChainedRun({ parentSkillId: a.id, subSkillId: nested.id, owner: OWNER, parentInput: {}, parentOutputs: {} })).toEqual({ skipped: "nested chaining is not allowed" });
  });
});

describe("a chained skill is authorized the same way a run is", () => {
  it("an org-shared skill can be triggered by a member", async () => {
    // Every other run path — startRun, the extension, the public API, triggers
    // — gates on skillAccess, which grants org members. This one asked its own
    // narrower question (owner, or published), so a team could run a shared
    // skill by hand from every surface in the product and NOT as a watch's
    // action: refused on every fire, about a skill they had just run.
    const author = "CHAIN_ORG_AUTHOR";
    const member = "CHAIN_ORG_MEMBER";
    const parent = await createSkill({ owner: author, generalized: gen("Parent"), sourceDemoId: null });
    const sub = await createSkill({ owner: author, generalized: gen("Shared"), sourceDemoId: null });

    // Not shared yet: refused, exactly as before.
    const before = await startChainedRun({
      parentSkillId: parent.id,
      subSkillId: sub.id,
      owner: member,
      parentInput: {},
      parentOutputs: {},
    });
    expect(before).toEqual({ skipped: "sub-skill not runnable by this owner" });

    const org = await createOrg(author, "Chain Org");
    expect(await addMember(org.id, author, member)).toBe(true);
    expect(await setSkillOrg(sub.id, author, org.id)).toBe(true);

    const after = await startChainedRun({
      parentSkillId: parent.id,
      subSkillId: sub.id,
      owner: member,
      parentInput: {},
      parentOutputs: {},
    });
    expect(after).not.toHaveProperty("skipped");
  });
});

describe("a credential never crosses into a child run", () => {
  const fields = [
    { key: "password", label: "Password", example: "" },
    { key: "month", label: "Month", example: "" },
  ];

  it("childInput drops parent keys that hold a secret", () => {
    // The parent's EFFECTIVE input is what gets handed over, and that is where
    // vault-filled values live. Mapped by key alone, a child field named the
    // same thing was filled with the credential and it was stored in plaintext
    // in the child run's input row.
    const mapped = childInput(
      fields,
      { password: "hunter2-from-vault", month: "july" },
      {},
      new Set(["password"]),
    );
    expect(mapped).toEqual({ month: "july" });
    expect(JSON.stringify(mapped)).not.toContain("hunter2");
  });

  it("a captured output cannot smuggle one in either", () => {
    const mapped = childInput(fields, {}, { password: "scraped", month: "july" }, new Set(["password"]));
    expect(mapped).toEqual({ month: "july" });
  });

  it("without the set nothing is dropped, so ordinary chaining is unchanged", () => {
    expect(childInput(fields, { password: "p", month: "july" }, {})).toEqual({
      password: "p",
      month: "july",
    });
  });

  it("the runner names its vault-filled and author-marked keys", () => {
    const src = readFileSync("lib/runner.ts", "utf8");
    expect(src).toMatch(/secretKeys: new Set\(\[\.\.\.vaultKeys, \.\.\.secretFieldKeys\]\)/);
  });
});
