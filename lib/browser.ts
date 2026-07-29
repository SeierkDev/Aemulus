import { chromium, type Browser, type LaunchOptions } from "playwright";
import { logError } from "./log";

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
function proxyOption(): NonNullable<LaunchOptions["proxy"]> | undefined {
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
