import type { BrowserContext, LaunchOptions, Route } from "playwright";

/**
 * Per-run isolation.
 *
 * Anyone can publish a skill and anyone else can run it, so every run executes
 * steps somebody else wrote. This module is the boundary around that: what the
 * run's browser may touch on the network, where it may write on disk, and what
 * it may reach on the host.
 *
 * Three layers, each independently enforced:
 *
 *   1. NETWORK   - egressDecision() below, applied to every HTTP request, plus
 *                  routeWebSockets() for the channel context.route() cannot see.
 *                  A skill declares the hosts it needs; anything that can carry
 *                  data OUT must target a declared host.
 *   2. FILESYSTEM- each run is its own Chromium process with its own profile,
 *                  created on launch and destroyed on close (see profileNote()).
 *   3. HOST      - Chromium's own OS sandbox left ON (chromiumSandbox: true plus
 *                  the non-root USER in the Dockerfile), so a page exploit is
 *                  contained by the kernel rather than landing as the app user.
 *
 * The vault is deliberately not in this list: credentials never enter a run of
 * somebody else's skill at all (see the owner === skill.owner check in the
 * runner), so there is nothing for the sandbox to contain.
 */

/**
 * Request classes that can carry data off the page. These are the exfiltration
 * channels: if a hostile skill wants to ship what it scraped to a server it
 * controls, it uses one of these.
 *
 * Note "websocket" is deliberately absent: Playwright's context.route() never
 * sees WebSocket connections at all, so listing it here would look like coverage
 * while blocking nothing. WebSockets are handled separately, and actually, by
 * routeWebSockets() below.
 */
const ACTIVE_TYPES = new Set([
  "xhr",
  "fetch",
  "eventsource",
  "manifest",
  "other", // sendBeacon, ping, CSP reports, and anything Chromium can't classify
]);

/**
 * Request classes that only pull bytes IN to render the page. Blocking these to
 * every host outside the allowlist breaks ordinary sites (CDN fonts, image
 * hosts, analytics-free asset domains) without meaningfully raising the bar,
 * because a page that wanted to leak a value could still do it through an
 * active channel. They stay subject to the SSRF guard either way.
 */
const PASSIVE_TYPES = new Set([
  "image",
  "stylesheet",
  "font",
  "media",
  "script",
  "texttrack",
]);

export type EgressVerdict = "allow" | "block";

export type EgressInput = {
  /** Playwright's request.resourceType() */
  resourceType: string;
  /** Whether Playwright classed this as a navigation */
  isNavigation: boolean;
  /** true if the URL's host matches the skill's declared allowlist */
  hostAllowed: boolean;
  /** true when the skill declared no hosts at all (unrestricted, back-compat) */
  unrestricted: boolean;
};

/**
 * The egress rule, isolated from Playwright so it can be tested directly.
 *
 * - No allowlist declared -> unrestricted (existing skills keep working; the
 *   SSRF guard in safe-url.ts still applies and is checked before this).
 * - Navigation -> must be a declared host. Already true before this module;
 *   kept here so the whole policy reads in one place.
 * - Active (data can leave) -> must be a declared host.
 * - Passive (data only comes in) -> allowed, so pages still render.
 *
 * Residual, stated plainly rather than hidden: a passive request can still
 * encode a small amount of data in a URL (an <img> pointed at a host that logs
 * its query string). Closing that means blocking third-party images and
 * stylesheets outright, which breaks the majority of real sites. The trade is
 * deliberate; strict mode below is the opt-out.
 */
export function egressDecision(i: EgressInput): EgressVerdict {
  if (i.unrestricted) return "allow";
  if (i.isNavigation) return i.hostAllowed ? "allow" : "block";
  if (ACTIVE_TYPES.has(i.resourceType)) return i.hostAllowed ? "allow" : "block";
  if (PASSIVE_TYPES.has(i.resourceType)) return "allow";
  // Unknown/future resource type: treat as active. Fail closed.
  return i.hostAllowed ? "allow" : "block";
}

/**
 * Strict mode (AEMULUS_SANDBOX_STRICT=1): every request, passive included, must
 * target a declared host. Correct for a skill whose allowlist genuinely covers
 * everything it loads; will visibly break skills that pull assets from a CDN.
 */
export function strictEgress(): boolean {
  return process.env.AEMULUS_SANDBOX_STRICT === "1";
}

export function decideEgress(i: EgressInput): EgressVerdict {
  if (strictEgress() && !i.unrestricted) return i.hostAllowed ? "allow" : "block";
  return egressDecision(i);
}

/**
 * Chromium flags that shrink what a run can reach on the host.
 *
 * Note what is NOT here: --no-sandbox. Chromium's setuid/namespace sandbox is
 * the thing standing between a compromised renderer and the host, and it is
 * silently disabled when the process runs as root — which is why the Dockerfile
 * drops to a non-root user. If you ever see --no-sandbox added back to make
 * something work in a container, the container is the bug.
 */
export function hardenedLaunchArgs(): string[] {
  return [
    // No shared memory with anything else on the box.
    "--disable-dev-shm-usage",
    // A run has no business talking to the host's GPU stack.
    "--disable-gpu",
    // Kill the background network chatter a fresh Chromium would otherwise do
    // on its own account (variations, safebrowsing lists, domain reliability):
    // egress from a run should only ever be the task.
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--no-default-browser-check",
    "--no-first-run",
    // Extensions and external protocol handlers are host-reaching surfaces the
    // task never needs.
    "--disable-extensions",
    "--disable-client-side-phishing-detection",
    // Don't let a page keep the process alive in the background.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];
}

/**
 * Is Chromium's OS sandbox on for this process?
 *
 * Playwright's launch() defaults chromiumSandbox to FALSE — it quietly passes
 * --no-sandbox for you — so this has to be turned on explicitly. It cannot start
 * as root, which is exactly why the Dockerfile drops to a non-root user.
 *
 * AEMULUS_CHROMIUM_SANDBOX=0 exists because an environment that genuinely cannot
 * run it (a host without user namespaces) would otherwise fail every run with no
 * way forward. Turning it off is a real reduction in isolation, so the flag is
 * read back into the recorded policy: the receipt says osSandbox:false and the
 * hash changes. The escape hatch cannot be used quietly.
 */
export function osSandboxEnabled(): boolean {
  return process.env.AEMULUS_CHROMIUM_SANDBOX !== "0";
}

/**
 * Launch options for a run.
 *
 * There is deliberately no per-run --user-data-dir here. Playwright refuses that
 * argument on launch() outright ("Pass userDataDir to launchPersistentContext
 * instead"), so an earlier version of this file created a directory, passed it
 * nowhere, and deleted it empty — filesystem isolation that existed only in the
 * receipt. What is actually true is better anyway: launch() gives every run its
 * own Chromium process with its own fresh profile directory, and removes it when
 * the browser closes. Per-run, unshared, destroyed after. Owned by Playwright
 * rather than by us, which is a provenance difference, not a security one.
 */
export function runLaunchOptions(): LaunchOptions {
  return {
    args: hardenedLaunchArgs(),
    chromiumSandbox: osSandboxEnabled(),
  };
}

/** Redirect hops a single navigation may take before we give up on it. */
const MAX_REDIRECT_HOPS = 10;

/**
 * A copy of `h` without the named keys.
 *
 * Written out rather than done with destructuring-and-rest, which needs a
 * throwaway binding per key and leaves the linter complaining about variables
 * that exist only to be discarded.
 */
function omitHeaders(
  h: Record<string, string>,
  ...keys: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

/** Same scheme, host and port — the boundary that decides whether credentials travel. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false; // unparseable: treat as a crossing, i.e. strip credentials
  }
}

/**
 * Ceiling on a navigation response we are willing to hand back to the page.
 *
 * Be precise about what this does and does not buy, because the obvious reading
 * is wrong. followNavigation must fetch a navigation itself to see its
 * redirects, and route.fetch() buffers the body EAGERLY — measured, a 400MB
 * navigation took this process from 184MB to 1016MB resident, and it did so
 * before this check could run. So the cap does not prevent the allocation. What
 * it does buy is that the body is never fulfilled into the page, and that the
 * navigation fails in ~1s instead of stalling for the full 45s timeout, which
 * is the difference between a blip and a run-slot held hostage.
 *
 * The residual is therefore a memory spike on a hostile navigation, bounded by
 * the run-slot concurrency limit and transient. That is a worse availability
 * story than route.continue()'s streaming, and it is the price of actually
 * preventing the SSRF-via-redirect path rather than detecting it afterwards.
 * The alternatives were measured and are worse: a HEAD preflight is defeated by
 * any server that answers HEAD and GET differently, which a malicious skill
 * author trivially controls on their own allowlisted domain.
 *
 * 32MB is far above any real HTML document. Downloads are already refused at
 * the context level (acceptDownloads:false).
 */
const MAX_NAV_BYTES = 32 * 1024 * 1024;

/**
 * Follow a navigation one redirect at a time, checking every hop.
 *
 * route.continue() hands the request to the network stack, which follows 3xx
 * redirects WITHOUT re-entering the route handler. Verified against a real
 * Chromium: a page allowlisted for one host was redirected to another and the
 * handler saw only the first URL. That defeated the navigation allowlist and,
 * far worse, the SSRF guard — a redirect to a link-local address fetched the
 * internal response and rendered it into the page, ready to be screenshotted.
 *
 * So navigations are fetched with maxRedirects:0 and each Location is validated
 * before it is followed. `validate` receives the absolute next URL and applies
 * the same checks the initial request got.
 *
 * KNOWN COST, stated rather than buried: because the final response is fulfilled
 * against the original request, page.url() stays at the pre-redirect address.
 * Content is correct and same-origin root-relative URLs still resolve, but after
 * a CROSS-ORIGIN redirect the page's notion of its own origin is stale, so a
 * root-relative fetch from that page targets the first origin. The alternative
 * (fulfilling the 3xx so the browser follows it natively) keeps the URL right but
 * only ever validates the FIRST hop — measured, not assumed: the browser's
 * follow-up request does not re-enter this handler — which leaves the exact hole
 * this function exists to close. Preventing the request wins over cosmetics.
 *
 * Fails closed. If the fetch itself throws, the navigation is aborted rather
 * than waved through, because a security boundary that opens on error is not
 * one.
 */
export async function followNavigation(
  route: Route,
  startUrl: string,
  validate: (url: string) => Promise<boolean> | boolean,
): Promise<void> {
  let current = startUrl;
  // Following a redirect is not "repeat the request at a new URL". RFC 7231 is
  // specific: on 301/302/303 a non-GET becomes a GET and the body is dropped;
  // only 307/308 preserve them. route.fetch() will happily resend whatever it
  // was given, and getting this wrong is not cosmetic — measured, a login POST
  // was re-sent verbatim to the redirect target, which both leaks the form body
  // (a password) to that host and turns Post/Redirect/Get, the pattern whose
  // entire purpose is preventing double submission, into a double submission.
  let method = route.request().method();
  let postData: string | undefined = route.request().postData() ?? undefined;
  // Carried explicitly so the entity headers can be stripped alongside the body
  // on a downgrade; a GET still advertising content-type/content-length is both
  // wrong and a hint to the target about what was posted upstream.
  let reqHeaders: Record<string, string> = { ...route.request().headers() };
  // A route may only be settled once. Track it so the catch below never tries to
  // abort a route that was already fulfilled — that throws "Route is already
  // handled!" and buries whatever the real failure was.
  let settled = false;
  const fulfill = async (response: unknown) => {
    settled = true;
    await route.fulfill({ response: response as never });
  };
  const abort = async () => {
    settled = true;
    await route.abort();
  };
  try {
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      // postData is passed ALWAYS, never omitted. Leaving the key out does not
      // mean "no body" — route.fetch() falls back to the original request's
      // body, so a downgraded GET still carried the POST payload. Measured.
      const res = await route.fetch({
        url: current,
        method,
        postData: postData ?? "",
        headers: reqHeaders,
        maxRedirects: 0,
      });
      // (Cosmetic artifact of passing an empty postData: the downgraded GET goes
      // out with content-type: application/octet-stream. Body is genuinely empty,
      // which is the part that matters.)
      const status = res.status();
      // Refuse to hand back a body we should never have been holding. See
      // MAX_NAV_BYTES: fetching in order to inspect redirects means buffering,
      // and an unbounded buffer is a way to kill the runner.
      const len = Number(res.headers()["content-length"] ?? "0");
      if (len > MAX_NAV_BYTES) return await abort();
      if (status < 300 || status >= 400) return await fulfill(res);
      const loc = res.headers()["location"];
      // A 3xx with nowhere to go: hand it back as-is rather than inventing one.
      if (!loc) return await fulfill(res);
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        return await abort();
      }
      if (!(await validate(next))) return await abort();
      // Crossing origins strips the credential headers, exactly as a browser
      // does. Measured before this existed: a session cookie set by the first
      // origin was handed to the second one, which is session theft dressed up
      // as a redirect. Cookie is dropped rather than rewritten because
      // route.fetch() applies the context's own cookie jar, which already knows
      // the right cookies for the new origin.
      if (!sameOrigin(current, next)) {
        reqHeaders = omitHeaders(
          reqHeaders,
          "cookie",
          "authorization",
          "proxy-authorization",
        );
      }
      // 303 always downgrades to GET; 301/302 do so for anything that isn't
      // already GET/HEAD, which is what every browser does in practice. 307/308
      // exist precisely to preserve the method, so leave those alone.
      if (
        (status === 301 || status === 302 || status === 303) &&
        method !== "GET" &&
        method !== "HEAD"
      ) {
        method = "GET";
        postData = undefined;
        reqHeaders = omitHeaders(reqHeaders, "content-type", "content-length");
      }
      current = next;
    }
    return await abort(); // redirect loop / too many hops
  } catch {
    if (!settled) await route.abort().catch(() => {});
  }
}

/**
 * Context options shared by every browser this app drives.
 *
 * Service workers are blocked outright. A worker registered by a page can
 * outlive the navigation that created it and issue its own requests, and
 * Playwright's request interception does not reliably cover them — so a page
 * could use one to step around the egress policy above. Nothing here needs a
 * service worker, blocking them is invisible on real sites (verified: pages
 * render normally, registration is simply refused), and doing it in the
 * recorder as well as the runner keeps a replay behaving like its recording.
 */
export function runContextOptions() {
  return { serviceWorkers: "block" as const };
}

/**
 * Block WebSocket connections to undeclared hosts.
 *
 * context.route() does not intercept WebSockets — verified, not assumed — so the
 * HTTP egress policy above is blind to them. Without this, a skill confined to
 * one host could still open a socket to anywhere and stream out everything it
 * read, which is the single widest hole the rest of this module would otherwise
 * leave open.
 */
export async function routeWebSockets(
  context: BrowserContext,
  allowedHosts: string[],
  hostAllowed: (url: string, allowed: string[]) => boolean,
): Promise<void> {
  if (allowedHosts.length === 0) return; // unrestricted skill: nothing to enforce
  await context.routeWebSocket(/.*/, (ws) => {
    if (hostAllowed(ws.url(), allowedHosts)) {
      // Connect through untouched; Playwright forwards frames both ways for us.
      ws.connectToServer();
      return;
    }
    // Never connected to the server, so nothing left the browser.
    ws.close();
  });
}

/**
 * What gets recorded on the run (and therefore hashed into the receipt), so the
 * isolation a run executed under is a fact anyone can check rather than a claim
 * on a marketing page.
 */
export type SandboxPolicy = {
  /** Policy version, so a receipt stays interpretable as this evolves. */
  v: number;
  /**
   * The outermost boundary this run actually executed behind.
   *
   * "micro-vm" — the browser ran inside a VM with its own kernel.
   * "process"  — the browser was its own process on a kernel shared with the
   *              rest of the box.
   *
   * Set from what was obtained, never from what was configured. A deployment
   * that asks for micro-VMs and doesn't get one records "process", because a
   * receipt is only worth anything if it describes the run that happened.
   */
  isolation: "micro-vm" | "process";
  /** Follows `isolation`; spelled out so a receipt reads without a lookup table. */
  kernel: "dedicated" | "shared";
  /** Hosts the skill declared; [] means the skill declared none. */
  allowedHosts: string[];
  /** "strict" | "standard" | "unrestricted" */
  egress: "strict" | "standard" | "unrestricted";
  /** Were WebSockets held to the allowlist too? */
  websockets: "allowlist" | "unrestricted";
  /**
   * Chromium OS sandbox active for this run. Read from the environment rather
   * than hardcoded true — a receipt that always claims the strongest setting
   * regardless of what actually happened is worse than no receipt.
   */
  osSandbox: boolean;
  /** Own Chromium process + own profile, destroyed when the run's browser closes. */
  ephemeralProfile: boolean;
  /** Service workers refused, so none can issue requests outside the egress route. */
  serviceWorkers: "blocked";
};

/**
 * What the run executed under.
 *
 * `actual` carries the facts only the acquisition path knows: which boundary was
 * obtained, and — for a micro-VM, where the browser is launched by the broker
 * rather than by us — whether Chromium's OS sandbox was confirmed on inside it.
 * Omitted for callers that launch locally, where the environment is the answer.
 */
export function sandboxPolicy(
  allowedHosts: string[],
  actual?: { isolation: "micro-vm" | "process"; osSandbox: boolean },
): SandboxPolicy {
  const unrestricted = allowedHosts.length === 0;
  const isolation = actual?.isolation ?? "process";
  return {
    // v2 adds isolation/kernel. Older receipts stay valid as written: the policy
    // is stored per run at run time, so bumping this cannot alter the canonical
    // form of anything already hashed.
    v: 2,
    isolation,
    kernel: isolation === "micro-vm" ? "dedicated" : "shared",
    allowedHosts,
    egress: unrestricted ? "unrestricted" : strictEgress() ? "strict" : "standard",
    websockets: unrestricted ? "unrestricted" : "allowlist",
    osSandbox: actual ? actual.osSandbox : osSandboxEnabled(),
    ephemeralProfile: true,
    serviceWorkers: "blocked",
  };
}
