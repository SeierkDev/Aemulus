import { describe, it, expect, vi, afterEach } from "vitest";
import { Aemulus, AemulusError } from "../sdk/index";

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return calls;
}

afterEach(() => vi.restoreAllMocks());

const client = new Aemulus({ apiKey: "aem_live_test", baseUrl: "http://test" });

describe("Aemulus SDK", () => {
  it("run() POSTs /api/v1/runs with the Bearer key + body", async () => {
    const calls = mockFetch(() => ({ body: { id: "run_1", status: "running" } }));
    const run = await client.run("skl_1", { vendor: "Acme" });
    expect(run).toEqual({ id: "run_1", status: "running" });
    expect(calls[0].url).toBe("http://test/api/v1/runs");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer aem_live_test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      skillId: "skl_1",
      input: { vendor: "Acme" },
    });
  });

  it("listSkills() returns a page { skills, nextCursor }", async () => {
    mockFetch(() => ({ body: { skills: [{ id: "a" }, { id: "b" }], nextCursor: "c1" } }));
    const page = await client.listSkills();
    expect(page.skills.map((s) => s.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("c1");
  });

  it("allSkills() follows cursors across pages", async () => {
    let call = 0;
    mockFetch(() =>
      call++ === 0
        ? { body: { skills: [{ id: "a" }], nextCursor: "c1" } }
        : { body: { skills: [{ id: "b" }], nextCursor: null } },
    );
    expect((await client.allSkills()).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("verify() hits the public endpoint with NO auth header", async () => {
    const calls = mockFetch(() => ({ body: { found: true, matches: true } }));
    const v = await client.verify("run_1");
    expect(v.matches).toBe(true);
    expect(calls[0].url).toBe("http://test/api/verify/run_1");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("throws AemulusError on a non-2xx response", async () => {
    mockFetch(() => ({ status: 401, body: { error: "Invalid or missing API key" } }));
    await expect(client.run("skl_1")).rejects.toBeInstanceOf(AemulusError);
  });

  it("runAndWait() polls until terminal", async () => {
    let getCalls = 0;
    mockFetch(({ init }) => {
      if (init.method === "POST") return { body: { id: "run_9", status: "running" } };
      getCalls++;
      return { body: { id: "run_9", status: getCalls < 2 ? "running" : "completed", output: { x: "1" } } };
    });
    const run = await client.runAndWait("skl_1", {}, { intervalMs: 1 });
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ x: "1" });
    expect(getCalls).toBeGreaterThanOrEqual(2);
  });
});
