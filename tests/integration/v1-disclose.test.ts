import { beforeAll, describe, expect, it, vi } from "vitest";
import { ready } from "../../lib/db";
import { createApiKey } from "../../lib/api-keys";
import { createSkill } from "../../lib/skills";
import { createRun, setRunOutput, setRunCommitment, getRun } from "../../lib/runs";
import { buildCommitment, commitmentFields } from "../../lib/commitment";
import { GET as discloseV1 } from "../../app/api/v1/runs/[id]/disclose/route";
import { POST as verifyDisclosureRoute } from "../../app/api/disclosures/verify/route";
import { Aemulus } from "../../sdk/index";
import type { GeneralizedSkill, Skill } from "../../lib/types";

vi.mock("../../lib/runner", () => ({ executeRun: vi.fn() }));

/**
 * The whole disclosure loop, end to end.
 *
 * This is the path I already got wrong once: the SDK's first verifyDisclosure()
 * posted the bundle inside a { disclosure } envelope, which the endpoint reads
 * at the top level. It type-checked and the stub tests would have agreed with it
 * had they been written to match the same mistake.
 *
 * So this produces a REAL bundle from the v1 endpoint, hands it to the SDK's own
 * client method, and lets that method's request reach the real verifier. If
 * either side's shape drifts, the round trip stops returning valid.
 */

const OWNER = "w_v1_disc";
const STRANGER = "w_v1_disc_other";
let skill: Skill;
let key = "";
let strangerKey = "";
let runId = "";

const req = (url: string, k?: string) =>
  new Request(url, k ? { headers: { authorization: `Bearer ${k}` } } : undefined);

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("v1 selective disclosure", () => {
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: OWNER,
      generalized: { name: "D", description: "", inputFields: [], steps: [] } as unknown as GeneralizedSkill,
      sourceDemoId: null,
    });
    key = (await createApiKey(OWNER, "t", ["read", "run"])).key;
    strangerKey = (await createApiKey(STRANGER, "t", ["read", "run"])).key;

    const run = await createRun({
      owner: OWNER,
      skillId: skill.id,
      runner: OWNER,
      input: {},
    } as never);
    runId = run!.id;
    // A commitment only exists for a run that produced output, and the runner
    // builds it after the run finishes. Do the same here — without it the
    // endpoint answers "no commitment" and the test proves nothing.
    await setRunOutput(runId, { total: "$42.00", status: "shipped" });
    const r = await getRun(runId);
    const c = buildCommitment(commitmentFields(r!));
    await setRunCommitment(runId, c.root, c.salts);
  });

  it("needs a key", async () => {
    const res = await discloseV1(req(`https://x/api/v1/runs/${runId}/disclose?field=output.total`), params(runId));
    expect(res.status).toBe(401);
  });

  it("hides another wallet's run behind not-found", async () => {
    const res = await discloseV1(
      req(`https://x/api/v1/runs/${runId}/disclose?field=output.total`, strangerKey),
      params(runId),
    );
    expect(res.status).toBe(404);
  });

  it("asks for a field", async () => {
    const res = await discloseV1(req(`https://x/api/v1/runs/${runId}/disclose`, key), params(runId));
    expect([400, 404]).toContain(res.status);
  });

  it("produces a bundle the real verifier accepts, through the SDK's own method", async () => {
    const res = await discloseV1(
      req(`https://x/api/v1/runs/${runId}/disclose?field=output.total`, key),
      params(runId),
    );
    // No early return: a run without a commitment would make this test pass
    // while exercising nothing, which is exactly how the first version of it
    // "passed".
    expect(res.status).toBe(200);
    const { disclosure } = await res.json();
    expect(disclosure).toMatchObject({ runId, field: "output.total", value: "$42.00" });

    // Route the SDK's request into the real verifier, so the body SHAPE the
    // client sends is the shape the server parses. This is the assertion that
    // the envelope bug would have failed.
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      verifyDisclosureRoute(
        new Request("https://x/api/disclosures/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: String(init?.body),
        }),
      )) as typeof fetch;
    try {
      // The client's own method, not a re-implementation of it — the point is
      // to test the body IT sends.
      const client = new Aemulus({ apiKey: "k", baseUrl: "https://x" });
      const out = await client.verifyDisclosure(disclosure);
      expect(out.valid).toBe(true);
      // bound is the part that matters: the proof belongs to THIS run, not to a
      // tree the sender built.
      expect(out.bound).toBe(true);
      expect(out.runId).toBe(runId);
    } finally {
      globalThis.fetch = original;
    }
  });
});
