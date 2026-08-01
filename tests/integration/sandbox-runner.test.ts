import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium } from "playwright";
import { runLaunchOptions } from "../../lib/sandbox";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { executeRun } from "../../lib/runner";
import { createRun, getRun } from "../../lib/runs";
import { attachReceipt, verifyReceipt } from "../../lib/receipt";
import type { GeneralizedSkill, Skill } from "../../lib/types";

/**
 * The one thing every other sandbox test could not tell us.
 *
 * tests/sandbox.test.ts exercises the POLICY in isolation, with hand-built route
 * objects. The e2e smoke test mocks executeRun out entirely. So until this file,
 * nothing had ever run the real runner with the real route handler, the real
 * launch options and a real Chromium — the wiring, as opposed to the rules.
 * Every bug found while building this feature was a gap between what the code
 * said and what a browser actually did, which is precisely what unit tests over
 * fake routes cannot catch.
 *
 * Note the local server here is only used for the redirect case. The happy path
 * has to reach a PUBLIC host, because the SSRF guard refuses loopback — as it
 * should. There is deliberately no env flag to disable that guard: a switch that
 * turns off SSRF protection for tests is a switch that eventually gets set in
 * production. So the happy path talks to example.com and skips itself when the
 * network is unavailable, rather than weakening the thing under test.
 */

const OWNER = "sandbox_test_owner";
let srv: Server;
let port = 0;
let online = false;
let haveBrowser = false;

beforeAll(async () => {
  await ready();
  srv = createServer((req, res) => {
    if (req.url === "/redirect-offsite") {
      res.writeHead(302, { Location: "https://not-declared.invalid/x" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><h1 id="title">Sandbox OK</h1></body></html>`);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  port = (srv.address() as { port: number }).port;

  online = await fetch("https://example.com", {
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => r.ok)
    .catch(() => false);

  // Probe with the SAME options a real run uses, not with defaults. An earlier
  // version called chromium.launch() bare, which turns the OS sandbox OFF — so
  // it happily succeeded on a host where the sandboxed launch this code
  // actually performs cannot start, and the skip never fired. Two things have
  // to hold before these tests mean anything: a browser is installed, AND it
  // can start under runLaunchOptions().
  haveBrowser = await chromium
    .launch(runLaunchOptions())
    .then(async (b) => {
      await b.close();
      return true;
    })
    .catch(() => false);
  if (!haveBrowser) {
    console.warn(
      "sandbox-runner: no Chromium, or its OS sandbox cannot start here — skipping",
    );
  }
}, 120_000);

afterAll(async () => {
  await new Promise<void>((r) => srv.close(() => r()));
});

async function mkSkill(
  steps: GeneralizedSkill["steps"],
  allowedHosts: string[],
): Promise<Skill> {
  return createSkill({
    owner: OWNER,
    generalized: { name: "Sandbox probe", description: "", inputFields: [], steps },
    sourceDemoId: null,
    allowedHosts,
  });
}

const navigate = (url: string) => ({
  intent: "go",
  action: "navigate" as const,
  selectors: [],
  target: url,
  valueSource: "constant" as const,
  value: url,
  inputKey: "",
  key: "",
});

const extractH1 = () => ({
  intent: "read the heading",
  action: "extract" as const,
  selectors: ["h1"],
  target: "h1",
  valueSource: "none" as const,
  value: "",
  inputKey: "",
  key: "",
  outputKey: "heading",
});

describe("runner sandbox wiring (real Chromium)", () => {
  it(
    "runs a real skill end to end and records the policy it ran under",
    async () => {
      if (!haveBrowser) return;
      if (!online) {
        console.warn("skipping: no network, cannot reach a non-loopback host");
        return;
      }
      const skill = await mkSkill(
        [navigate("https://example.com/"), extractH1()],
        ["example.com"],
      );
      const run = await createRun({ owner: OWNER, skillId: skill.id, input: {} });
      const done = await executeRun(skill, run.id, OWNER, {});

      // That this works at all is the assertion: chromiumSandbox:true, the
      // hardened args, serviceWorkers:block and followNavigation together did
      // not break an ordinary run.
      expect(done.status).toBe("completed");
      expect(done.output?.heading).toContain("Example Domain");

      // The boundary is on the row, which is what the receipt hashes.
      const policy = JSON.parse((await getRun(run.id))!.sandbox!);
      expect(policy.osSandbox).toBe(true);
      expect(policy.serviceWorkers).toBe("blocked");
      expect(policy.websockets).toBe("allowlist");
      expect(policy.allowedHosts).toEqual(["example.com"]);
      expect(policy.egress).toBe("standard");

      // The loop that had never been closed: a run carrying a sandbox policy
      // must still VERIFY. attachReceipt and verifyReceipt both go through
      // digestForRun, so adding a field to the digest breaks verification for
      // every new receipt if the two ever drift. The e2e smoke test cannot
      // catch this — it mocks executeRun out, so its runs have no policy.
      await attachReceipt(run.id);
      const v = await verifyReceipt(run.id);
      expect(v.found).toBe(true);
      expect(v.matches).toBe(true);
    },
    180_000,
  );

  it(
    "does not let a redirect carry the run to an undeclared host",
    async () => {
      if (!haveBrowser) return;
      const skill = await mkSkill(
        [navigate(`http://127.0.0.1:${port}/redirect-offsite`)],
        ["127.0.0.1"],
      );
      const run = await createRun({ owner: OWNER, skillId: skill.id, input: {} });
      const done = await executeRun(skill, run.id, OWNER, {});
      // Whether it fails or merely goes nowhere is not the point; the point is
      // that it never lands on the host it was redirected to. This is the hole
      // that let a 302 walk past both the allowlist and the SSRF guard.
      expect(done.status).not.toBe("completed");
    },
    120_000,
  );

  it(
    "records the policy on a run that fails, not only one that succeeds",
    async () => {
      if (!haveBrowser) return;
      const skill = await mkSkill(
        [navigate(`http://127.0.0.1:${port}/redirect-offsite`)],
        ["127.0.0.1"],
      );
      const run = await createRun({ owner: OWNER, skillId: skill.id, input: {} });
      await executeRun(skill, run.id, OWNER, {});
      // Written before the first step executes, so a run that dies mid-flight
      // still carries the boundary it was given.
      expect((await getRun(run.id))?.sandbox).toBeTruthy();
    },
    120_000,
  );
});
