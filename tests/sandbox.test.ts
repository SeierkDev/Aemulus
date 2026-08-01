import { describe, it, expect, afterEach } from "vitest";
import {
  decideEgress,
  egressDecision,
  hardenedLaunchArgs,
  followNavigation,
  osSandboxEnabled,
  sameOrigin,
  routeWebSockets,
  runContextOptions,
  runLaunchOptions,
  sandboxPolicy,
  type EgressInput,
} from "../lib/sandbox";
import { receiptDigest } from "../lib/receipt";

/** Defaults for a request from a skill that DID declare an allowlist. */
const req = (over: Partial<EgressInput> = {}): EgressInput => ({
  resourceType: "fetch",
  isNavigation: false,
  hostAllowed: false,
  unrestricted: false,
  ...over,
});

describe("egress policy", () => {
  it("lets a skill with no declared hosts do anything (back-compat)", () => {
    expect(egressDecision(req({ unrestricted: true }))).toBe("allow");
    expect(
      egressDecision(req({ unrestricted: true, isNavigation: true })),
    ).toBe("allow");
  });

  it("blocks navigation off the allowlist", () => {
    expect(egressDecision(req({ isNavigation: true }))).toBe("block");
    expect(
      egressDecision(req({ isNavigation: true, hostAllowed: true })),
    ).toBe("allow");
  });

  // The reason this module exists: before it, only navigations were checked, so
  // a skill could read a page and ship the contents anywhere it liked.
  it("blocks every exfiltration channel to an undeclared host", () => {
    // "websocket" is absent on purpose: context.route() never surfaces it, so
    // it is enforced by routeWebSockets() instead. Listing it here would test
    // a branch that never executes in production.
    for (const t of ["fetch", "xhr", "eventsource", "other"]) {
      expect(egressDecision(req({ resourceType: t })), t).toBe("block");
      expect(
        egressDecision(req({ resourceType: t, hostAllowed: true })),
        t,
      ).toBe("allow");
    }
  });

  it("still loads passive resources from anywhere so pages render", () => {
    for (const t of ["image", "stylesheet", "font", "media", "script"]) {
      expect(egressDecision(req({ resourceType: t })), t).toBe("allow");
    }
  });

  it("fails closed on a resource type it doesn't recognise", () => {
    expect(egressDecision(req({ resourceType: "some-future-type" }))).toBe(
      "block",
    );
  });

  describe("strict mode", () => {
    afterEach(() => {
      delete process.env.AEMULUS_SANDBOX_STRICT;
    });

    it("holds passive resources to the allowlist too", () => {
      process.env.AEMULUS_SANDBOX_STRICT = "1";
      expect(decideEgress(req({ resourceType: "image" }))).toBe("block");
      expect(
        decideEgress(req({ resourceType: "image", hostAllowed: true })),
      ).toBe("allow");
    });

    it("does not retroactively restrict skills that declared no hosts", () => {
      process.env.AEMULUS_SANDBOX_STRICT = "1";
      expect(
        decideEgress(req({ resourceType: "fetch", unrestricted: true })),
      ).toBe("allow");
    });
  });
});

describe("launch hardening", () => {
  afterEach(() => {
    delete process.env.AEMULUS_CHROMIUM_SANDBOX;
  });

  it("never disables Chromium's OS sandbox via args", () => {
    const args = hardenedLaunchArgs();
    expect(args).not.toContain("--no-sandbox");
    expect(args).not.toContain("--disable-setuid-sandbox");
  });

  // Playwright's launch() defaults chromiumSandbox to false and passes
  // --no-sandbox for you, so this must be set explicitly or the whole host
  // boundary is off while looking fine.
  it("turns the OS sandbox on explicitly", () => {
    expect(runLaunchOptions().chromiumSandbox).toBe(true);
    expect(osSandboxEnabled()).toBe(true);
  });

  it("honours the escape hatch, and the receipt admits it", () => {
    process.env.AEMULUS_CHROMIUM_SANDBOX = "0";
    expect(runLaunchOptions().chromiumSandbox).toBe(false);
    // The point of the flag being readable here: a run with the sandbox off
    // must not produce a receipt claiming it was on.
    expect(sandboxPolicy(["example.com"]).osSandbox).toBe(false);
  });
});

describe("sandboxPolicy", () => {
  it("reports unrestricted when the skill declared no hosts", () => {
    expect(sandboxPolicy([]).egress).toBe("unrestricted");
  });

  it("reports standard, and carries the declared hosts, when it did", () => {
    const p = sandboxPolicy(["example.com"]);
    expect(p.egress).toBe("standard");
    expect(p.allowedHosts).toEqual(["example.com"]);
    expect(p.osSandbox).toBe(true);
    expect(p.ephemeralProfile).toBe(true);
    expect(p.websockets).toBe("allowlist");
    expect(p.serviceWorkers).toBe("blocked");
  });

  // Service workers can outlive the page that registered them and issue
  // requests the egress route does not reliably see, so they are refused in
  // every context — including for a skill that declared no hosts.
  it("blocks service workers even for an unrestricted skill", () => {
    expect(sandboxPolicy([]).serviceWorkers).toBe("blocked");
    expect(runContextOptions().serviceWorkers).toBe("block");
  });

  it("does not claim websocket enforcement for a skill with no allowlist", () => {
    expect(sandboxPolicy([]).websockets).toBe("unrestricted");
  });
});

describe("websocket routing", () => {
  // A stand-in for the slice of BrowserContext routeWebSockets touches. The API
  // shape here was verified against a real Chromium launch before this was
  // written — context.route() genuinely never surfaces a websocket, which is
  // why this separate path exists at all.
  function fakeContext() {
    let handler: ((ws: FakeWs) => void) | null = null;
    return {
      registered: () => handler !== null,
      routeWebSocket: async (_re: RegExp, h: (ws: FakeWs) => void) => {
        handler = h;
      },
      open(url: string) {
        const ws: FakeWs = {
          url: () => url,
          connected: false,
          closed: false,
          connectToServer() {
            this.connected = true;
          },
          close() {
            this.closed = true;
          },
        };
        handler?.(ws);
        return ws;
      },
    };
  }
  type FakeWs = {
    url(): string;
    connected: boolean;
    closed: boolean;
    connectToServer(): void;
    close(): void;
  };

  const allow = (url: string, hosts: string[]) => {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some((d) => h === d || h.endsWith(`.${d}`));
  };

  it("closes a socket to an undeclared host without ever connecting it", async () => {
    const ctx = fakeContext();
    await routeWebSockets(ctx as never, ["example.com"], allow);
    const ws = ctx.open("wss://evil.test/collect");
    expect(ws.closed).toBe(true);
    expect(ws.connected).toBe(false); // nothing left the browser
  });

  it("passes a socket to a declared host straight through", async () => {
    const ctx = fakeContext();
    await routeWebSockets(ctx as never, ["example.com"], allow);
    const ws = ctx.open("wss://app.example.com/live");
    expect(ws.connected).toBe(true);
    expect(ws.closed).toBe(false);
  });

  it("registers no handler at all when the skill declared no hosts", async () => {
    const ctx = fakeContext();
    await routeWebSockets(ctx as never, [], allow);
    expect(ctx.registered()).toBe(false);
  });
});

describe("redirect following", () => {
  // route.continue() lets the network stack follow 3xx WITHOUT re-entering the
  // route handler, which walked past both the allowlist and the SSRF guard.
  // Verified against a real Chromium before this was written.
  type Res = { status: number; headers: Record<string, string> };
  type Sent = { url: string; method?: string; postData?: string };
  function fakeRoute(chain: Res[], req?: { method: string; postData: string }) {
    const calls: string[] = [];
    const sent: Sent[] = [];
    const sentHeaders: Record<string, string>[] = [];
    let i = 0;
    return {
      calls,
      sent,
      sentHeaders,
      fulfilled: false,
      aborted: false,
      request: () => ({
        method: () => req?.method ?? "GET",
        postData: () => req?.postData ?? null,
        headers: () => ({
          "content-type": "application/x-www-form-urlencoded",
          cookie: "sid=SECRET",
          authorization: "Bearer SECRET",
        }),
      }),
      async fetch(opts: {
        url: string;
        method?: string;
        postData?: string;
        headers?: Record<string, string>;
      }) {
        calls.push(opts.url);
        sent.push({ url: opts.url, method: opts.method, postData: opts.postData });
        sentHeaders.push(opts.headers ?? {});
        const r = chain[Math.min(i++, chain.length - 1)];
        return { status: () => r.status, headers: () => r.headers };
      },
      async fulfill() {
        this.fulfilled = true;
      },
      async abort() {
        this.aborted = true;
      },
    };
  }

  it("aborts as soon as a hop fails validation", async () => {
    const route = fakeRoute([
      { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } },
    ]);
    await followNavigation(
      route as never,
      "https://good.test/go",
      (u) => !u.includes("169.254.169.254"),
    );
    expect(route.aborted).toBe(true);
    expect(route.fulfilled).toBe(false);
    // Critically: it never fetched the internal address.
    expect(route.calls).toEqual(["https://good.test/go"]);
  });

  it("validates every hop, not just the first", async () => {
    const route = fakeRoute([
      { status: 302, headers: { location: "https://also-good.test/b" } },
      { status: 302, headers: { location: "http://169.254.169.254/" } },
    ]);
    await followNavigation(route as never, "https://good.test/a", (u) =>
      !u.includes("169.254.169.254"),
    );
    expect(route.aborted).toBe(true);
    expect(route.calls).toHaveLength(2); // followed hop 1, refused hop 2
  });

  it("resolves a relative Location against the current URL", async () => {
    const seen: string[] = [];
    const route = fakeRoute([
      { status: 302, headers: { location: "/landed" } },
      { status: 200, headers: {} },
    ]);
    await followNavigation(route as never, "https://good.test/deep/page", (u) => {
      seen.push(u);
      return true;
    });
    expect(seen).toEqual(["https://good.test/landed"]);
    expect(route.fulfilled).toBe(true);
  });

  it("gives up on a redirect loop instead of spinning", async () => {
    const route = fakeRoute([{ status: 302, headers: { location: "/loop" } }]);
    await followNavigation(route as never, "https://good.test/loop", () => true);
    expect(route.aborted).toBe(true);
  });

  // RFC 7231. Getting this wrong re-sent a login POST verbatim to the redirect
  // target: it leaks the form body to that host, and it turns Post/Redirect/Get
  // — the pattern whose whole job is preventing double submission — into a
  // double submission. Both were reproduced against a real server.
  it("downgrades POST to GET and drops the body on 302", async () => {
    const route = fakeRoute(
      [
        { status: 302, headers: { location: "/dashboard" } },
        { status: 200, headers: {} },
      ],
      { method: "POST", postData: "pw=SECRET" },
    );
    await followNavigation(route as never, "https://good.test/login", () => true);
    expect(route.sent[0].method).toBe("POST"); // original request unchanged
    expect(route.sent[1].method).toBe("GET"); // the hop is downgraded
    // Explicitly empty, not omitted: leaving postData out makes route.fetch()
    // fall back to the original body, which is how the leak happened.
    expect(route.sent[1].postData).toBe("");
  });

  it("does the same for 301 and 303", async () => {
    for (const status of [301, 303]) {
      const route = fakeRoute(
        [{ status, headers: { location: "/next" } }, { status: 200, headers: {} }],
        { method: "POST", postData: "pw=SECRET" },
      );
      await followNavigation(route as never, "https://good.test/a", () => true);
      expect(route.sent[1].method, String(status)).toBe("GET");
      expect(route.sent[1].postData, String(status)).toBe("");
    }
  });

  it("preserves method and body on 307/308, which exist for exactly that", async () => {
    for (const status of [307, 308]) {
      const route = fakeRoute(
        [{ status, headers: { location: "/next" } }, { status: 200, headers: {} }],
        { method: "POST", postData: "pw=SECRET" },
      );
      await followNavigation(route as never, "https://good.test/a", () => true);
      expect(route.sent[1].method, String(status)).toBe("POST");
      expect(route.sent[1].postData, String(status)).toBe("pw=SECRET");
    }
  });

  // A browser strips credential headers when a redirect crosses origins.
  // Measured before this existed: origin A's session cookie was handed to
  // origin B, which is session theft dressed up as a redirect.
  it("strips credential headers when a redirect crosses origins", async () => {
    const route = fakeRoute([
      { status: 302, headers: { location: "https://other.test/landed" } },
      { status: 200, headers: {} },
    ]);
    await followNavigation(route as never, "https://good.test/a", () => true);
    const sent = route.sentHeaders[1];
    expect(sent).not.toHaveProperty("cookie");
    expect(sent).not.toHaveProperty("authorization");
  });

  it("keeps them on a same-origin hop, or every login breaks", async () => {
    const route = fakeRoute([
      { status: 302, headers: { location: "/landed" } },
      { status: 200, headers: {} },
    ]);
    await followNavigation(route as never, "https://good.test/a", () => true);
    expect(route.sentHeaders[1]).toHaveProperty("cookie");
  });

  it("treats an unparseable URL as a crossing and strips anyway", () => {
    expect(sameOrigin("https://a.test/", "not a url")).toBe(false);
    expect(sameOrigin("https://a.test/x", "https://a.test/y")).toBe(true);
    // Port and scheme are part of the origin.
    expect(sameOrigin("https://a.test/", "https://a.test:8443/")).toBe(false);
    expect(sameOrigin("http://a.test/", "https://a.test/")).toBe(false);
  });

  it("refuses to hand back an oversized navigation body", async () => {
    const route = fakeRoute([
      { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } },
    ]);
    await followNavigation(route as never, "https://good.test/huge", () => true);
    expect(route.aborted).toBe(true);
    expect(route.fulfilled).toBe(false);
  });

  it("lets an ordinary page through", async () => {
    const route = fakeRoute([
      { status: 200, headers: { "content-length": "48213" } },
    ]);
    await followNavigation(route as never, "https://good.test/page", () => true);
    expect(route.fulfilled).toBe(true);
    expect(route.aborted).toBe(false);
  });

  // Regression: the catch used to abort unconditionally, which throws
  // "Route is already handled!" on a route that was fulfilled and buries the
  // real failure.
  it("does not settle a route twice when fulfil throws", async () => {
    let aborts = 0;
    const route = {
      request: () => ({
        method: () => "GET",
        postData: () => null,
        headers: () => ({}),
      }),
      async fetch() {
        return { status: () => 200, headers: () => ({}) };
      },
      async fulfill() {
        throw new Error("Route is already handled!");
      },
      async abort() {
        aborts++;
      },
    };
    await followNavigation(route as never, "https://good.test/", () => true);
    expect(aborts).toBe(0);
  });

  it("fails closed when the fetch itself throws", async () => {
    const route = {
      aborted: false,
      fulfilled: false,
      request: () => ({
        method: () => "GET",
        postData: () => null,
        headers: () => ({}),
      }),
      async fetch() {
        throw new Error("network down");
      },
      async fulfill() {
        this.fulfilled = true;
      },
      async abort() {
        this.aborted = true;
      },
    };
    await followNavigation(route as never, "https://good.test/", () => true);
    expect(route.aborted).toBe(true);
    expect(route.fulfilled).toBe(false);
  });
});

describe("receipt digest", () => {
  const base = {
    runId: "r1",
    skillId: "s1",
    owner: "o1",
    status: "completed",
    steps: [],
  };

  // Receipts written before sandboxing must keep hashing to what they already
  // hashed to, or every anchored receipt in existence stops verifying.
  it("is unchanged for a run with no sandbox policy", () => {
    expect(receiptDigest({ ...base, sandbox: null })).toBe(
      receiptDigest(base),
    );
    expect(receiptDigest({ ...base, sandbox: undefined })).toBe(
      receiptDigest(base),
    );
  });

  it("changes when the policy changes, so the boundary is tamper-evident", () => {
    const strict = receiptDigest({
      ...base,
      sandbox: JSON.stringify(sandboxPolicy(["example.com"])),
    });
    const open = receiptDigest({
      ...base,
      sandbox: JSON.stringify(sandboxPolicy([])),
    });
    expect(strict).not.toBe(open);
    expect(strict).not.toBe(receiptDigest(base));
  });
});
