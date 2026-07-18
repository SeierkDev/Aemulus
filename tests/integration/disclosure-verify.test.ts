import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { POST } from "../../app/api/disclosures/verify/route";
import { buildCommitment, discloseField } from "../../lib/commitment";
import { createRun, setRunCommitment } from "../../lib/runs";
import { createSkill } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

const gen = (): GeneralizedSkill => ({
  name: "Disc",
  description: "",
  inputFields: [],
  steps: [{ intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" }],
});

function post(body: unknown): Request {
  return new Request("http://t/api/disclosures/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function runWithCommitment(fields: { name: string; value: string }[]): Promise<{ runId: string; root: string; salts: Record<string, string> }> {
  const skill = await createSkill({ owner: "DISC_OWNER", generalized: gen(), sourceDemoId: null });
  const run = await createRun({ owner: "DISC_OWNER", skillId: skill.id, input: {} });
  const commit = buildCommitment(fields);
  await setRunCommitment(run.id, commit.root, commit.salts);
  return { runId: run.id, root: commit.root, salts: commit.salts };
}

beforeAll(async () => {
  await ready();
});

describe("POST /api/disclosures/verify — binding to the run's committed root", () => {
  it("verifies a genuine disclosure bound to its run", async () => {
    const fields = [{ name: "output.total", value: "$42.00" }];
    const { runId, root, salts } = await runWithCommitment(fields);
    const bundle = discloseField(fields, salts, root, "output.total")!;
    const d = await (await POST(post({ runId, ...bundle }))).json();
    expect(d.valid).toBe(true);
    expect(d.bound).toBe(true);
    expect(d.runId).toBe(runId);
  });

  it("REJECTS a membership-valid proof built against an attacker-chosen root (the core fix)", async () => {
    // A real run that commits a total but NOT an approval.
    const { runId } = await runWithCommitment([{ name: "output.total", value: "$42.00" }]);
    // Attacker builds their OWN tree asserting "output.approved = true" — a
    // cryptographically valid membership proof, but in a root the run never committed.
    const evilFields = [{ name: "output.approved", value: "true" }];
    const evil = buildCommitment(evilFields);
    const evilBundle = discloseField(evilFields, evil.salts, evil.root, "output.approved")!;
    const d = await (await POST(post({ runId, ...evilBundle }))).json();
    expect(d.valid).toBe(false); // root != the run's committed root
    expect(d.bound).toBe(false);
  });

  it("REJECTS a real proof re-based onto a DIFFERENT run (cross-run substitution)", async () => {
    const fields = [{ name: "output.total", value: "$42.00" }];
    const a = await runWithCommitment(fields);
    const b = await runWithCommitment([{ name: "output.total", value: "$999.00" }]);
    const bundleA = discloseField(fields, a.salts, a.root, "output.total")!;
    // Present run A's valid bundle but claim it's for run B.
    const d = await (await POST(post({ runId: b.runId, ...bundleA }))).json();
    expect(d.valid).toBe(false); // A's root != B's committed root
  });

  it("REJECTS a bundle with no runId (can't be bound)", async () => {
    const fields = [{ name: "output.total", value: "$1.00" }];
    const { root, salts } = await runWithCommitment(fields);
    const bundle = discloseField(fields, salts, root, "output.total")!;
    const d = await (await POST(post({ ...bundle }))).json(); // runId omitted
    expect(d.valid).toBe(false);
  });
});
