import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Aemulus } from "../sdk/index";

/**
 * The SDK is a wire contract, and the wire is where it breaks.
 *
 * Types can be wrong in a way that compiles perfectly: the first version of
 * verifyDisclosure() posted the bundle wrapped in a { disclosure } envelope,
 * which the endpoint reads at the top level. It type-checked, it shipped a
 * request the server could only answer with { valid: false }, and nothing in
 * the response would have said why.
 *
 * So these tests run the client against a stub server and assert the SHAPE of
 * what actually goes out and comes back.
 */

function stub(handler: (req: Request) => Response | Promise<Response>) {
  const calls: { url: string; method: string; body: unknown; auth?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", body, auth: headers.authorization });
    return handler(new Request(url, { method: init?.method ?? "GET" }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

const client = () => new Aemulus({ apiKey: "k_test", baseUrl: "https://example.test" });

const BUNDLE = {
  runId: "run_1",
  field: "total",
  value: "$42.00",
  salt: "abcd",
  root: "3d90",
  proof: { siblings: [{ hash: "aa", left: true }] },
};

describe("disclosure over the wire", () => {
  it("asks the API-key endpoint, not the session one", async () => {
    const s = stub(() => json({ disclosure: BUNDLE }));
    try {
      const d = await client().disclose("run_1", "total");
      expect(s.calls[0].url).toBe(
        "https://example.test/api/v1/runs/run_1/disclose?field=total",
      );
      // The whole reason the v1 route exists: an SDK cannot present a browser
      // session, so the old /api/runs/[id]/disclose was unreachable from code.
      expect(s.calls[0].url).not.toContain("/api/runs/");
      expect(s.calls[0].auth).toBe("Bearer k_test");
      expect(d.field).toBe("total");
    } finally {
      s.restore();
    }
  });

  it("encodes a field name that needs it", async () => {
    const s = stub(() => json({ disclosure: BUNDLE }));
    try {
      await client().disclose("run_1", "order total/net");
      expect(s.calls[0].url).toContain("field=order%20total%2Fnet");
    } finally {
      s.restore();
    }
  });

  // The bug this file exists for.
  it("posts the bundle flat, not wrapped in an envelope", async () => {
    const s = stub(() => json({ valid: true, bound: true, runId: "run_1" }));
    try {
      await client().verifyDisclosure(BUNDLE);
      const sent = s.calls[0].body as Record<string, unknown>;
      expect(sent.runId).toBe("run_1");
      expect(sent.root).toBe("3d90");
      expect(sent).not.toHaveProperty("disclosure");
    } finally {
      s.restore();
    }
  });

  // Verification is public. Sending a key would be harmless but wrong, and it
  // would quietly imply you need one to check somebody else's proof.
  it("verifies without an API key", async () => {
    const s = stub(() => json({ valid: true, bound: true }));
    try {
      await client().verifyDisclosure(BUNDLE);
      expect(s.calls[0].auth).toBeUndefined();
    } finally {
      s.restore();
    }
  });

  // valid and bound are separate answers: a proof can be internally consistent
  // and still belong to a tree the sender made up.
  it("keeps bound separate from valid", async () => {
    const s = stub(() => json({ valid: false, bound: false }));
    try {
      const r = await client().verifyDisclosure(BUNDLE);
      expect(r.valid).toBe(false);
      expect(r.bound).toBe(false);
    } finally {
      s.restore();
    }
  });
});

describe("what a run and a verification now carry", () => {
  it("surfaces the fields the server already returned", async () => {
    const s = stub(() =>
      json({
        id: "run_1", status: "completed", skillVersion: 3,
        outcomeStatus: "achieved", sandbox: '{"osSandbox":true}',
        agencHash: "0x8b", commitmentRoot: "3d90", repairedSteps: 1,
      }),
    );
    try {
      const run = await client().getRun("run_1");
      expect(run.skillVersion).toBe(3);
      expect(run.outcomeStatus).toBe("achieved");
      expect(run.sandbox).toContain("osSandbox");
      expect(run.agencHash).toBe("0x8b");
      expect(run.repairedSteps).toBe(1);
    } finally {
      s.restore();
    }
  });

  it("passes through the parts of a verification it used to drop", async () => {
    const s = stub(() =>
      json({
        found: true, matches: true, repairedSteps: 2, missingShots: 0,
        commitmentRoot: "3d90", sandbox: '{"osSandbox":true}',
        agenc: { constraintHash: "0x8b", commitment: null, arity: 4 },
      }),
    );
    try {
      const v = await client().verify("run_1");
      expect(v.repairedSteps).toBe(2);
      expect(v.missingShots).toBe(0);
      expect(v.agenc?.arity).toBe(4);
      expect(v.commitmentRoot).toBe("3d90");
    } finally {
      s.restore();
    }
  });

  // A run with no receipt is a normal answer, not a failure.
  it("still turns a missing receipt into found:false", async () => {
    const s = stub(() => json({ error: "Not found" }, 404));
    try {
      const v = await client().verify("run_missing");
      expect(v.found).toBe(false);
      expect(v.runId).toBe("run_missing");
    } finally {
      s.restore();
    }
  });
});

describe("the published surface", () => {
  const src = readFileSync("sdk/index.ts", "utf8");

  it("documents every method it exports", () => {
    for (const m of ["disclose(", "verifyDisclosure(", "runAndWait(", "verify("]) {
      expect(src).toContain(m);
    }
  });
});

describe("watches over the wire", () => {
  it("creates schedule and rule in one call", async () => {
    const s = stub(() => json({ id: "sch_1", cadence: "every30m", rule: { key: "price", op: "changed" } }, 201));
    try {
      const w = await client().createWatch({
        skillId: "skl_1",
        cadence: "every30m",
        rule: { key: "price", op: "changed" },
      });
      expect(s.calls[0].url).toBe("https://example.test/api/v1/watches");
      expect(s.calls[0].method).toBe("POST");
      // Both halves in one body. A schedule created without its rule burns the
      // watch allowance every cadence and reports nothing.
      const sent = s.calls[0].body as Record<string, unknown>;
      expect(sent.skillId).toBe("skl_1");
      expect(sent.rule).toEqual({ key: "price", op: "changed" });
      expect(w.id).toBe("sch_1");
    } finally {
      s.restore();
    }
  });

  it("unwraps the list", async () => {
    const s = stub(() => json({ watches: [{ id: "sch_1", rule: { key: "price", op: "changed" } }] }));
    try {
      const list = await client().listWatches();
      expect(Array.isArray(list)).toBe(true);
      expect(list[0].id).toBe("sch_1");
    } finally {
      s.restore();
    }
  });

  it("pauses with PATCH and removes with DELETE", async () => {
    const s = stub(() => json({ id: "sch_1", active: false }));
    try {
      await client().setWatchActive("sch_1", false);
      expect(s.calls[0].method).toBe("PATCH");
      expect((s.calls[0].body as Record<string, unknown>).active).toBe(false);
      await client().deleteWatch("sch_1");
      expect(s.calls[1].method).toBe("DELETE");
    } finally {
      s.restore();
    }
  });
});

/**
 * The docs are part of the release.
 *
 * A method nobody can find is a method nobody uses, and /developers is the only
 * page that shows how any of this is called. The disclosure step shipped in the
 * first pass and watches and webhooks did not — caught by reading the page, not
 * by any check, which is why there is one now.
 */
describe("what /developers shows", () => {
  const page = readFileSync("app/developers/page.tsx", "utf8");

  it("documents every capability the client exposes", () => {
    for (const m of ["createWatch", "listWatches", "disclose", "verifyDisclosure", "verifyWebhook"]) {
      expect(page).toContain(m);
    }
  });

  // The namespace is the thing people get wrong: the committed field is
  // "output.total", and asking for "total" is answered with unknown field.
  it("uses the real committed field name in the disclosure example", () => {
    expect(page).toContain('disclose(run.id, "output.total")');
  });

  // Verifying a re-serialised body silently never matches.
  it("says to verify the raw body", () => {
    expect(page).toMatch(/RAW body|rawBody/);
  });
});
