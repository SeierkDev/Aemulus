import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/health/route";
import { incr, metricsSnapshot } from "../../lib/metrics";

describe("metrics", () => {
  it("increments named counters", () => {
    const before = metricsSnapshot()["test.counter"] ?? 0;
    incr("test.counter");
    incr("test.counter", 2);
    expect(metricsSnapshot()["test.counter"]).toBe(before + 3);
  });

  it("snapshot is a copy (mutating it doesn't affect the store)", () => {
    incr("test.copy");
    const snap = metricsSnapshot();
    snap["test.copy"] = 9999;
    expect(metricsSnapshot()["test.copy"]).not.toBe(9999);
  });
});

describe("GET /api/health", () => {
  const req = (headers?: Record<string, string>) =>
    new Request("http://test/api/health", { headers });

  it("public probe: reports ok + db but NO internal telemetry", async () => {
    incr("runs.started");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    expect(typeof body.uptimeMs).toBe("number");
    // Anonymous callers must NOT see metrics / job depth / gating state.
    expect(body.metrics).toBeUndefined();
    expect(body.jobs).toBeUndefined();
    expect(body.gating).toBeUndefined();
  });

  it("exposes detailed telemetry only with the ops token", async () => {
    process.env.AEMULUS_METRICS_TOKEN = "ops-secret";
    incr("runs.started");
    // Wrong/absent token → still minimal.
    expect((await (await GET(req({ "x-metrics-token": "wrong" }))).json()).metrics).toBeUndefined();
    // Correct token → detailed body.
    const body = await (await GET(req({ "x-metrics-token": "ops-secret" }))).json();
    expect(body.metrics).toBeTypeOf("object");
    expect(body.metrics["runs.started"]).toBeGreaterThanOrEqual(1);
    delete process.env.AEMULUS_METRICS_TOKEN;
  });
});
