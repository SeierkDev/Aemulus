import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock the runner (no browser) and the session (no cookies).
vi.mock("../../lib/runner", () => ({
  executeRun: vi.fn(async () => ({ status: "completed" })),
}));
const session = { pubkey: "RETRY_OWNER", tier: "Open", level: 3, balance: 0 };
vi.mock("../../lib/auth", () => ({ requireAccess: vi.fn(async () => session) }));

import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createRun, getRun } from "../../lib/runs";
import { POST } from "../../app/api/runs/[id]/retry/route";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "R", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("POST /api/runs/[id]/retry", () => {
  it("starts a NEW run inheriting the original's input + corrected overrides", async () => {
    const skill = await createSkill({
      owner: session.pubkey,
      generalized: GEN,
      sourceDemoId: null,
    });
    const orig = await createRun({
      owner: session.pubkey,
      skillId: skill.id,
      input: { vendor: "Acme" },
      overrides: { "2": { selector: "#fixed" } },
    });

    const res = await POST(new Request("http://t/x", { method: "POST" }), {
      params: Promise.resolve({ id: orig.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).not.toBe(orig.id); // a fresh run

    const fresh = await getRun(body.run.id);
    expect(fresh!.input).toEqual({ vendor: "Acme" });
    expect(fresh!.overrides).toEqual({ "2": { selector: "#fixed" } });
  });

  it("404s when retrying a run you don't own", async () => {
    const skill = await createSkill({
      owner: "SOMEONE_ELSE",
      generalized: GEN,
      sourceDemoId: null,
    });
    const other = await createRun({
      owner: "SOMEONE_ELSE",
      skillId: skill.id,
      input: {},
      overrides: {},
    });
    const res = await POST(new Request("http://t/x", { method: "POST" }), {
      params: Promise.resolve({ id: other.id }),
    });
    expect(res.status).toBe(404);
  });
});
