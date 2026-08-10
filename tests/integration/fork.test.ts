import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ready } from "../../lib/db";
import {
  createSkill,
  forkCount,
  forkSkill,
  getSkill,
  listSkillVersions,
  restoreSkillVersion,
  setPublished,
  setSkillOrg,
  updateSkill,
} from "../../lib/skills";
import { createOrg, addMember } from "../../lib/orgs";
import type { GeneralizedSkill, SkillStep } from "../../lib/types";

/**
 * Forking: taking someone else's published skill and making it yours.
 *
 * The marketplace was read-only in practice — run what is there, or record your
 * own from nothing. A skill that is nearly right for your portal was a dead
 * end, so the half-right ones died instead of becoming five better ones.
 */

const gen = (name: string): GeneralizedSkill => ({
  name,
  description: "reads the total",
  inputFields: [{ key: "month", label: "Month", example: "july" }],
  steps: [],
});

const STEPS = [
  {
    idx: 0,
    intent: "open it",
    action: "navigate",
    selectors: [],
    target: "https://portal.example/invoices",
    valueSource: "none",
    value: "",
    inputKey: "",
    key: "",
  },
] as SkillStep[];

const AUTHOR = "FORK_AUTHOR";
const OTHER = "FORK_OTHER";

beforeAll(async () => {
  await ready();
});

async function published(name: string) {
  const s = await createSkill({ owner: AUTHOR, generalized: gen(name), sourceDemoId: null });
  await updateSkill(s.id, {
    name: s.name,
    description: s.description,
    plan: STEPS,
    inputSchema: s.inputSchema,
    allowedHosts: ["portal.example"],
  });
  await setPublished(s.id, AUTHOR, true);
  return (await getSkill(s.id))!;
}

describe("what comes across", () => {
  it("the plan, the inputs and the allowed hosts", async () => {
    const src = await published("Read the total");
    const res = await forkSkill(src.id, OTHER);
    expect(res).not.toHaveProperty("refused");
    const fork = (await getSkill((res as { id: string }).id))!;
    expect(fork.owner).toBe(OTHER);
    expect(fork.plan).toEqual(src.plan);
    expect(fork.inputSchema).toEqual(src.inputSchema);
    expect(fork.allowedHosts).toEqual(src.allowedHosts);
    expect(fork.forkedFrom).toBe(src.id);
  });

  it("and what deliberately does not", async () => {
    const src = await published("Second");
    const fork = (await getSkill(((await forkSkill(src.id, OTHER)) as { id: string }).id))!;
    // Publishing someone else's work under your name is a decision, not a default.
    expect(fork.published).toBe(false);
    // Earned by the original, not by the copy.
    expect(fork.runCount).toBe(0);
    expect(fork.version).toBe(1);
    // The recording belongs to the author, and can hold what their browser saw.
    expect(fork.sourceDemoId).toBeNull();
    expect(fork.orgId).toBeNull();
  });

  it("named so a shelf of forks is not the same title repeated", async () => {
    const src = await published("Chase the invoice");
    const fork = (await getSkill(((await forkSkill(src.id, OTHER)) as { id: string }).id))!;
    expect(fork.name).toBe("Chase the invoice (fork)");
  });
});

describe("who may fork", () => {
  it("anyone, once it is published", async () => {
    const src = await published("Public one");
    expect(await forkSkill(src.id, OTHER)).not.toHaveProperty("refused");
  });

  it("nobody, while it is private", async () => {
    const s = await createSkill({ owner: AUTHOR, generalized: gen("Private"), sourceDemoId: null });
    expect(await forkSkill(s.id, OTHER)).toEqual({ refused: "That skill isn't yours to fork." });
  });

  it("a teammate, when it is shared with an org", async () => {
    // The same authority every other path asks, rather than a second answer to
    // "may this wallet use this skill".
    const s = await createSkill({ owner: AUTHOR, generalized: gen("Shared"), sourceDemoId: null });
    const org = await createOrg(AUTHOR, "Fork Org");
    await addMember(org.id, AUTHOR, OTHER);
    await setSkillOrg(s.id, AUTHOR, org.id);
    expect(await forkSkill(s.id, OTHER)).not.toHaveProperty("refused");
  });

  it("and a skill that is gone is refused, not crashed into", async () => {
    expect(await forkSkill("skl_nope", OTHER)).toEqual({
      refused: "That skill no longer exists.",
    });
  });
});

describe("a fork is a copy, not a reference", () => {
  it("editing the original changes nothing in the fork", async () => {
    const src = await published("Original");
    const fork = (await getSkill(((await forkSkill(src.id, OTHER)) as { id: string }).id))!;
    await updateSkill(src.id, {
      name: "Rewritten",
      description: "different now",
      plan: [],
      inputSchema: { fields: [] },
    });
    const after = (await getSkill(fork.id))!;
    expect(after.plan).toEqual(STEPS);
    expect(after.inputSchema.fields).toHaveLength(1);
  });

  it("unpublishing the original leaves the fork runnable", async () => {
    const src = await published("Withdrawn");
    const fork = (await getSkill(((await forkSkill(src.id, OTHER)) as { id: string }).id))!;
    await setPublished(src.id, AUTHOR, false);
    const after = (await getSkill(fork.id))!;
    expect(after.plan).toEqual(STEPS);
    expect(after.forkedFrom).toBe(src.id);
  });
});

describe("what the original can show", () => {
  it("counts what it spawned", async () => {
    const src = await published("Popular");
    expect(await forkCount(src.id)).toBe(0);
    await forkSkill(src.id, OTHER);
    await forkSkill(src.id, "FORK_THIRD");
    expect(await forkCount(src.id)).toBe(2);
  });

  it("a fork of a fork records its immediate parent", async () => {
    const src = await published("Root");
    const a = (await forkSkill(src.id, OTHER)) as { id: string };
    await setPublished(a.id, OTHER, true);
    const b = (await forkSkill(a.id, "FORK_THIRD")) as { id: string };
    expect((await getSkill(b.id))!.forkedFrom).toBe(a.id);
    expect(await forkCount(src.id)).toBe(1);
  });
});

describe("naming a parent that is no longer public", () => {
  it("the marketplace only names a published one", () => {
    // A private skill's existence and title are not a stranger's to learn from
    // a page about someone else's fork.
    const page = readFileSync("app/market/[id]/page.tsx", "utf8");
    expect(page).toMatch(/const parent = parentRaw && parentRaw\.published \? parentRaw : null/);
  });

  it("the editor names it for its own owner too", () => {
    // You are allowed to know where your own skill came from.
    const page = readFileSync("app/skills/[id]/page.tsx", "utf8");
    expect(page).toMatch(/parentRaw\.published \|\| parentRaw\.owner === session\.pubkey/);
  });
});

describe("what forking is not a way around", () => {
  it("the per-owner skill cap", async () => {
    // It is the cheapest way to make a skill — no recording, no model call — so
    // it was the easiest way past the bound that keeps this table finite. The
    // check lives in forkSkill rather than the route, so every caller gets it.
    const src = await published("Capped");
    const lib = readFileSync("lib/skills.ts", "utf8");
    const fn = lib.slice(lib.indexOf("export async function forkSkill"), lib.indexOf("/** How many skills were forked"));
    expect(fn).toMatch(/countSkillsByOwner\(owner\)\) >= MAX_SKILLS_PER_OWNER/);
    // And the other creation paths still enforce it, so this is the same bound.
    for (const f of ["app/api/skills/generalize/route.ts", "app/api/skills/synthesize/route.ts"]) {
      expect(readFileSync(f, "utf8")).toMatch(/countSkillsByOwner/);
    }
    expect(await forkSkill(src.id, OTHER)).not.toHaveProperty("refused");
  });

  it("a template, whose steps are placeholders", async () => {
    // The point of a template is that you record your own version; a copy of
    // the placeholders can never run.
    const s = await createSkill({ owner: AUTHOR, generalized: gen("Starter"), sourceDemoId: null });
    await updateSkill(s.id, {
      name: "Starter",
      description: "",
      plan: STEPS,
      inputSchema: { fields: [], template: { tool: "QuickBooks" } },
    });
    await setPublished(s.id, AUTHOR, true).catch(() => {});
    const res = await forkSkill(s.id, OTHER);
    expect(res).toHaveProperty("refused");
    expect((res as { refused: string }).refused).toMatch(/starter template/i);
  });

  it("and the button is not offered on one", () => {
    const page = readFileSync("app/market/[id]/page.tsx", "utf8");
    expect(page).toMatch(/\{!tmpl && skill\.owner !== session\?\.pubkey && \(/);
  });
});

describe("a fork's history starts where it forked", () => {
  it("has a v1 holding the plan it was forked at", async () => {
    const src = await published("Versioned");
    const fork = (await forkSkill(src.id, OTHER)) as { id: string };
    const vs = await listSkillVersions(fork.id);
    expect(vs).toHaveLength(1);
    expect(vs[0].version).toBe(1);
  });

  it("so editing it does not destroy what you forked", async () => {
    // updateSkill derives the next version from the highest SNAPSHOT. With none,
    // the first edit wrote another v1 holding the EDITED state — and the plan
    // you forked was gone, which is the one version a fork most needs, since
    // the reason to fork is that you are about to change it.
    const src = await published("Editable");
    const fork = (await forkSkill(src.id, OTHER)) as { id: string };
    await updateSkill(fork.id, {
      name: "My version",
      description: "changed",
      plan: [],
      inputSchema: { fields: [] },
    });
    const vs = await listSkillVersions(fork.id);
    expect(vs.map((v) => v.version).sort()).toEqual([1, 2]);
    // v1 is still the plan it was forked at, so rolling back gets it.
    expect(await restoreSkillVersion(fork.id, 1)).toBe(true);
    expect((await getSkill(fork.id))!.plan).toEqual(STEPS);
  });
});

describe("the fork route matches its siblings", () => {
  const route = readFileSync("app/api/skills/[id]/fork/route.ts", "utf8");

  it("rate limits per wallet, like the other two creation routes", () => {
    // Creating a skill is guarded at two layers: the per-owner cap inside
    // createSkill/forkSkill, and a per-wallet rate limit in the route. A new
    // creation path has to match its siblings at BOTH — folding everything into
    // createSkill would not have covered this one.
    expect(route).toMatch(/enforceRateLimit\(\s*`fork:\$\{session\.pubkey\}`/);
    expect(route).toMatch(/60 \* 60 \* 1000/);
    for (const f of ["app/api/skills/generalize/route.ts", "app/api/skills/synthesize/route.ts"]) {
      expect(readFileSync(f, "utf8")).toMatch(/enforceRateLimit\(/);
    }
  });

  it("and refuses before doing any work", () => {
    const limitAt = route.indexOf("enforceRateLimit(");
    const workAt = route.indexOf("await forkSkill(");
    expect(limitAt).toBeGreaterThan(0);
    expect(limitAt).toBeLessThan(workAt);
  });
});
