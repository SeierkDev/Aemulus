import { chromium, type Browser, type LaunchOptions } from "playwright";

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
 * which patches each of those tells on every new page. It is OFF by default and
 * fully inert unless AEMULUS_STEALTH=1 — with the flag unset this module is a
 * thin pass-through to plain Playwright, so existing runs are byte-for-byte
 * unchanged and the puppeteer-extra dependency chain is never even loaded.
 */
export function stealthEnabled(): boolean {
  return process.env.AEMULUS_STEALTH === "1";
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
export async function launchBrowser(opts?: LaunchOptions): Promise<Browser> {
  if (stealthEnabled()) {
    const extra = await getStealthChromium();
    return extra.launch(opts);
  }
  return chromium.launch(opts);
}
