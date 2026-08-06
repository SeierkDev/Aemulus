import { chromium, type Browser, type LaunchOptions } from "playwright";
import { logError } from "./log";
import {
  leaseMicrovm,
  mayRunWithoutMicrovm,
  releaseMicrovm,
  type IsolationMode,
  type MicrovmLease,
} from "./microvm";

/**
 * Centralized Chromium launcher for runs and recordings.
 *
 * Bot-detection walls (Cloudflare, DataDome, PerimeterX, Akamai) fingerprint
 * the "tells" a headless automation browser leaves behind — navigator.webdriver
 * being set, missing/blank navigator.plugins, an absent window.chrome, the
 * HeadlessChrome UA token, and so on. On the sites people most want to automate
 * (banks, portals, LinkedIn) those tells get the run blocked outright.
 *
 * Stealth mode routes the launch through playwright-extra + the stealth plugin,
 * which patches each of those tells on every new page. It is ON by default
 * (real-world sites are the norm), and only turned OFF with AEMULUS_STEALTH=0 —
 * in which case this module is a thin pass-through to plain Playwright and the
 * puppeteer-extra dependency chain is never even loaded. Stealth also makes a
 * captcha *solvable by a human*: without it, a session is pre-flagged as a bot
 * and the challenge loops "try again" no matter who clicks it.
 */
export function stealthEnabled(): boolean {
  return process.env.AEMULUS_STEALTH !== "0";
}

// Built at most once, lazily, and only when stealth is actually turned on — so
// the puppeteer-extra graph stays out of memory on the default path. The stealth
// plugin is applied to the shared extra-chromium instance; every browser it
// launches inherits the patches.
let stealthChromium: Promise<{
  launch(opts?: LaunchOptions): Promise<Browser>;
}> | null = null;

function getStealthChromium() {
  if (!stealthChromium) {
    stealthChromium = (async () => {
      const { chromium: extra } = await import("playwright-extra");
      const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
      extra.use(stealth());
      // playwright-extra returns playwright-core's Browser; structurally identical
      // to the `playwright` Browser the rest of the code uses.
      return extra as unknown as {
        launch(opts?: LaunchOptions): Promise<Browser>;
      };
    })();
  }
  return stealthChromium;
}

/**
 * Launch Chromium for a run or recording. Transparently uses the stealth stack
 * when AEMULUS_STEALTH=1, otherwise plain Playwright. Returns the same
 * playwright `Browser` either way, so callers are identical.
 */
/**
 * Optional outbound proxy for every run + recording — set AEMULUS_PROXY_SERVER
 * (e.g. a residential/mobile proxy) to route the browser through a non-datacenter
 * IP. This is what actually gets past "unusual traffic from your network" walls
 * (Google, Amazon) that flag Railway/cloud IPs; stealth alone can't fix the IP.
 */
export function proxyOption(): NonNullable<LaunchOptions["proxy"]> | undefined {
  const server = process.env.AEMULUS_PROXY_SERVER?.trim();
  if (!server) return undefined;
  return {
    server,
    username: process.env.AEMULUS_PROXY_USERNAME?.trim() || undefined,
    password: process.env.AEMULUS_PROXY_PASSWORD?.trim() || undefined,
  };
}

export async function launchBrowser(opts?: LaunchOptions): Promise<Browser> {
  const proxy = proxyOption();
  const merged: LaunchOptions = proxy ? { ...opts, proxy } : opts ?? {};
  if (stealthEnabled()) {
    try {
      const extra = await getStealthChromium();
      return await extra.launch(merged);
    } catch (e) {
      // The stealth stack (playwright-extra + plugin graph) failed to load or
      // launch in this environment. Never let that block a recording or run —
      // fall back to plain Playwright. Reset the cached instance so a transient
      // failure can retry next time.
      logError("browser.stealth-launch", e);
      stealthChromium = null;
    }
  }
  return chromium.launch(merged);
}

/** Connecting waits on a VM that is already booted, so this is short by design. */
const CONNECT_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.AEMULUS_MICROVM_CONNECT_TIMEOUT_MS) || 20_000,
);

/**
 * A browser for one run, plus the boundary it actually got and how to give it
 * back.
 *
 * `isolation` is deliberately returned rather than inferred by the caller: it is
 * what ends up hashed into the receipt, and the only thing that knows whether a
 * micro-VM was really obtained is the code that tried to obtain one.
 */
export type RunBrowser = {
  browser: Browser;
  isolation: IsolationMode;
  /** True only when the broker CONFIRMED Chromium's OS sandbox inside the VM. */
  osSandbox: boolean;
  /** Closes the browser and hands any VM back. Safe to call once, never throws. */
  dispose: () => Promise<void>;
};

/**
 * Get the browser a run will execute in.
 *
 * Tries for a micro-VM first when the deployment is configured for one. If it
 * gets a lease, the browser lives inside that VM and is driven over the wire;
 * otherwise this is the same local launch as before and the caller is told so.
 *
 * Two behaviours worth naming, because both are easy to get subtly wrong:
 *
 *   - A failed CONNECT after a successful lease releases the VM before falling
 *     back. Without that, every connect failure would strand a booted VM until
 *     the broker's own timeout reaped it, and a run of failures would exhaust
 *     the pool while each individual run looked fine.
 *   - The fallback records "process". It does not record what it was hoping for.
 *     (In require mode leaseMicrovm throws instead, so there is no fallback to
 *     mislabel.)
 *
 * Stealth and the outbound proxy are launch-time settings, so inside a VM they
 * are applied by the broker from the lease request rather than here — the
 * plugin graph in this process has nothing to patch on a browser it did not
 * launch.
 */
export async function acquireRunBrowser(opts: {
  runId: string;
  headless: boolean;
  launch: LaunchOptions;
}): Promise<RunBrowser> {
  const proxy = proxyOption();
  const lease: MicrovmLease | null = await leaseMicrovm({
    runId: opts.runId,
    args: opts.launch.args ?? [],
    chromiumSandbox: opts.launch.chromiumSandbox === true,
    headless: opts.headless,
    stealth: stealthEnabled(),
    ...(proxy ? { proxy } : {}),
  });

  if (lease) {
    try {
      const browser = await chromium.connect(lease.wsEndpoint, {
        timeout: CONNECT_TIMEOUT_MS,
      });
      let done = false;
      return {
        browser,
        isolation: "micro-vm",
        osSandbox: lease.osSandbox,
        dispose: async () => {
          if (done) return;
          done = true;
          await browser.close().catch(() => {});
          await releaseMicrovm(lease);
        },
      };
    } catch (e) {
      logError("browser.microvm-connect", e);
      await releaseMicrovm(lease);
      // The VM booted and the endpoint came back; only the connection failed.
      // leaseMicrovm() did NOT throw for this — it succeeded — so require mode
      // has to be enforced here or it degrades silently on exactly the path it
      // was turned on to prevent.
      if (!mayRunWithoutMicrovm()) {
        throw new Error("micro-vm isolation is required and the leased VM could not be reached");
      }
      // Otherwise fall through to a local launch, recorded honestly as "process".
    }
  }

  const browser = await launchBrowser({ headless: opts.headless, ...opts.launch });
  let done = false;
  return {
    browser,
    isolation: "process",
// `=== true`, not `!== false`: Playwright defaults this to false and passes
    // --no-sandbox for you, so an omitted flag means the sandbox is OFF. Reading
    // it as on would put the wrong answer in the receipt.
    osSandbox: opts.launch.chromiumSandbox === true,
    dispose: async () => {
      if (done) return;
      done = true;
      await browser.close().catch(() => {});
    },
  };
}
