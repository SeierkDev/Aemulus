import { describe, it, expect } from "vitest";
import { OPENAPI } from "../lib/openapi";
import { GET } from "../app/api/openapi.json/route";

describe("OpenAPI spec", () => {
  it("is a valid-shaped 3.x document", () => {
    expect(OPENAPI.openapi).toMatch(/^3\./);
    expect(OPENAPI.info.title).toContain("Aemulus");
    expect(OPENAPI.components.securitySchemes).toHaveProperty("ApiKey");
  });

  it("documents every public endpoint", () => {
    const paths = Object.keys(OPENAPI.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/v1/runs",
        "/api/v1/runs/{id}",
        "/api/v1/skills",
        "/api/verify/{runId}",
        "/api/batch/{id}/bundle",
      ]),
    );
  });

  it("marks the public endpoints as no-auth (security: [])", () => {
    const verify = OPENAPI.paths["/api/verify/{runId}"].get as { security?: unknown[] };
    const bundle = OPENAPI.paths["/api/batch/{id}/bundle"].get as { security?: unknown[] };
    expect(verify.security).toEqual([]);
    expect(bundle.security).toEqual([]);
    // a keyed endpoint has no per-op override (inherits global ApiKey security)
    expect((OPENAPI.paths["/api/v1/skills"].get as { security?: unknown }).security).toBeUndefined();
  });

  it("is served as JSON at /api/openapi.json", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toMatch(/^3\./);
  });
});
