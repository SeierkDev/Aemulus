import type { Page, CDPSession } from "playwright";

/**
 * Live interactive sessions for mid-run human handoff (e.g. a 2FA prompt the
 * runner can't fill). When a run hits an interactive checkpoint, the runner
 * registers its LIVE page here and awaits a resume signal: the owner watches a
 * screencast and drives the page (the same browser/context, so an authenticated
 * session persists), then clicks Continue and the run proceeds.
 *
 * The pause/resume control plane is pure + testable; the CDP screencast and
 * input injection are best-effort (browser-dependent).
 */
interface LiveSession {
  page: Page;
  cdp: CDPSession | null;
  lastFrame: string | null;
  resolve: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
}

declare global {
  var __aemLive: Map<string, LiveSession> | undefined;
}
const sessions: Map<string, LiveSession> = (globalThis.__aemLive ??= new Map());

const VIEW = { width: 1280, height: 800 };
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));

export type LiveInputEvent =
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; dy: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string };

export function liveSessionActive(runId: string): boolean {
  return sessions.has(runId);
}

/** Register a run's live page and start streaming it (screencast best-effort). */
export async function registerLive(runId: string, page: Page): Promise<void> {
  const s: LiveSession = { page, cdp: null, lastFrame: null, resolve: null, timer: null };
  sessions.set(runId, s);
  try {
    const cdp = await page.context().newCDPSession(page);
    s.cdp = cdp;
    cdp.on("Page.screencastFrame", async (f: { data: string; sessionId: number }) => {
      s.lastFrame = f.data;
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
      } catch {
        /* page closing */
      }
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: VIEW.width,
      maxHeight: VIEW.height,
      everyNthFrame: 1,
    });
  } catch {
    /* screencast unavailable - the Continue flow still works without frames */
  }
}

export function liveFrame(runId: string): { data: string | null; url: string } {
  const s = sessions.get(runId);
  if (!s) return { data: null, url: "" };
  let url = "";
  try {
    url = s.page.url();
  } catch {
    /* navigating */
  }
  return { data: s.lastFrame, url };
}

export async function liveInput(runId: string, ev: LiveInputEvent): Promise<void> {
  const s = sessions.get(runId);
  if (!s) return;
  const page = s.page;
  try {
    if (ev.type === "click") await page.mouse.click(clamp(ev.x, VIEW.width), clamp(ev.y, VIEW.height));
    else if (ev.type === "scroll") await page.mouse.wheel(0, ev.dy);
    else if (ev.type === "text") await page.keyboard.type(ev.text);
    else if (ev.type === "key") await page.keyboard.press(ev.key);
  } catch {
    /* drop the event if the page is mid-navigation */
  }
}

/** Block until resumeLive(runId) is called or timeoutMs elapses. */
export function waitForResume(
  runId: string,
  timeoutMs: number,
): Promise<"resumed" | "timeout"> {
  return new Promise((resolve) => {
    const s = sessions.get(runId);
    if (!s) return resolve("timeout");
    const t = setTimeout(() => {
      s.resolve = null;
      s.timer = null;
      resolve("timeout");
    }, timeoutMs);
    s.timer = t;
    s.resolve = () => {
      clearTimeout(t);
      s.timer = null;
      resolve("resumed");
    };
  });
}

/** Signal the run to continue. Returns false if nothing is waiting. */
export function resumeLive(runId: string): boolean {
  const s = sessions.get(runId);
  if (!s || !s.resolve) return false;
  s.resolve();
  return true;
}

export async function unregisterLive(runId: string): Promise<void> {
  const s = sessions.get(runId);
  if (!s) return;
  // Clear any pending wait-timer so a torn-down session can't leak a timeout
  // (and the page closure it captures) for up to LIVE_TIMEOUT.
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  s.resolve = null;
  try {
    await s.cdp?.send("Page.stopScreencast");
  } catch {
    /* ignore */
  }
  sessions.delete(runId);
}
