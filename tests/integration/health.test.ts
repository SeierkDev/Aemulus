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
  it("reports ok + db reachable + a metrics object", async () => {
    incr("runs.started");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    expect(typeof body.uptimeMs).toBe("number");
    expect(body.metrics).toBeTypeOf("object");
    expect(body.metrics["runs.started"]).toBeGreaterThanOrEqual(1);
  });
});
