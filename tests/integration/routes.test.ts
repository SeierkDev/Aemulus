import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createApiKey } from "../../lib/api-keys";
import { createSkill, setPublished } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

import { GET as skillsGET } from "../../app/api/v1/skills/route";
import { POST as runsPOST } from "../../app/api/v1/runs/route";
import { GET as runGET } from "../../app/api/v1/runs/[id]/route";
import { GET as verifyGET } from "../../app/api/verify/[runId]/route";
import { GET as bundleGET } from "../../app/api/batch/[id]/bundle/route";
import { POST as mcpPOST } from "../../app/api/mcp/route";

const OWNER = "WALLET_ROUTES";
let KEY = "";

function bearer(method: string, body?: unknown): Request {
  return new Request("http://t/x", {
    method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const noauth = (method: string, body?: unknown) =>
  new Request("http://t/x", {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const gen = (name: string): GeneralizedSkill => ({
  name,
  description: "d",
  inputFields: [{ key: "vendor", label: "Vendor", example: "Acme" }],
  steps: [
    {
      intent: "o",
      action: "navigate",
      selectors: [],
      target: "data:text/html,<p>x</p>",
      valueSource: "none",
      value: "",
      inputKey: "",
      key: "",
    },
  ],
});

beforeAll(async () => {
  await ready();
  KEY = (await createApiKey(OWNER, "routes")).key;
  const s = await createSkill({ owner: OWNER, generalized: gen("Route skill"), sourceDemoId: null });
  await setPublished(s.id, OWNER, true);
});

describe("GET /api/v1/skills", () => {
  it("401 without a key, 200 + catalog with one", async () => {
    expect((await skillsGET(noauth("GET"))).status).toBe(401);
    const res = await skillsGET(bearer("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.skills[0]).toHaveProperty("category");
  });
});

describe("POST /api/v1/runs (guard paths)", () => {
  it("401 without key", async () => {
    expect((await runsPOST(noauth("POST", { skillId: "x" }))).status).toBe(401);
  });
  it("400 on invalid body", async () => {
    expect((await runsPOST(bearer("POST", {}))).status).toBe(400);
  });
  it("404 on unknown skill", async () => {
    const res = await runsPOST(bearer("POST", { skillId: "skl_nope" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/runs/:id", () => {
  it("401 without key, 404 for unknown run", async () => {
    expect((await runGET(noauth("GET"), { params: Promise.resolve({ id: "r" }) })).status).toBe(401);
    const res = await runGET(bearer("GET"), { params: Promise.resolve({ id: "run_nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("public verify + bundle", () => {
  it("verify 404 for unknown run (no auth needed)", async () => {
    const res = await verifyGET(noauth("GET"), { params: Promise.resolve({ runId: "run_nope" }) });
    expect(res.status).toBe(404);
    expect((await res.json()).found).toBe(false);
  });
  it("bundle 404 for unknown batch", async () => {
    const res = await bundleGET(noauth("GET"), { params: Promise.resolve({ id: "batch_nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/mcp", () => {
  it("401 without key; initialize returns serverInfo with a key", async () => {
    expect((await mcpPOST(noauth("POST", { jsonrpc: "2.0", id: 1, method: "initialize" }))).status).toBe(401);
    const res = await mcpPOST(bearer("POST", { jsonrpc: "2.0", id: 1, method: "initialize" }));
    expect(res.status).toBe(200);
    expect((await res.json()).result.serverInfo.name).toBe("aemulus");
  });
  it("202 for a notification", async () => {
    const res = await mcpPOST(bearer("POST", { jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });
});
