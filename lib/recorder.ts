import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import { launchBrowser } from "./browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { id } from "./ids";
import { recorderInitScript } from "./recorder-inject";
import { isUnsafeRequestUrl, navHostResolvesPrivate } from "./safe-url";
import type { RecordedAction, RecorderState } from "./types";

// window.__aemRecord is reachable by ANY script on the recorded page, so the raw
// payload is untrusted: validate + bound it before storing (a hostile page can't
// fabricate oversized/malformed actions), and cap the number of actions so a
// scripted page can't flood the recording (cost/DoS on the later generalize).
const MAX_ACTIONS = 1000;
const RawActionSchema = z.object({
  type: z.enum(["navigate", "click", "input", "select", "key", "submit", "extract", "run_skill"]),
  selectors: z.array(z.string().max(2000)).max(50).optional(),
  tag: z.string().max(40).optional(),
  role: z.string().max(80).optional(),
  name: z.string().max(2000).optional(),
  text: z.string().max(2000).optional(),
  value: z.string().max(5000).optional(),
  sensitive: z.boolean().optional(),
  key: z.string().max(40).optional(),
});

/**
 * Server-side recorder. Launches a HEADLESS Chromium, streams its screen to the
 * browser via CDP screencast, and forwards the user's mouse/keyboard back via
 * Playwright (which dispatches trusted DOM events) - so it works for a remote
 * user on a hosted deploy, not just on localhost. The injected script still
 * reports each interaction, building the trace exactly as before.
 *
 * Exactly one session is active at a time. The instance is cached on
 * globalThis so Next.js hot-reload doesn't orphan a live browser.
 */

const RECORDINGS_DIR = path.join(process.cwd(), ".data", "recordings");
const VIEWPORT = { width: 1280, height: 800 };
// Auto-stop an abandoned recording (tab closed / network lost) so it can't leak a
// headless browser or wedge the wallet's recorder slot forever.
const IDLE_MS = Math.max(30_000, Number(process.env.AEMULUS_RECORD_IDLE_MS) || 120_000);

/** Payload the in-page script sends; Node enriches it into a RecordedAction. */
type RawAction = Omit<RecordedAction, "idx" | "ts" | "url" | "screenshot">;

/** An input event forwarded from the streamed view (coords in viewport px). */
export type InputEvent =
  | { type: "click"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "scroll"; dy: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string };

class RecorderSession {
  state: RecorderState | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private lastFrame: string | null = null;
  private frameSeq = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes screenshot+trace writes so indexes never race. */
  private tail: Promise<void> = Promise.resolve();
  /**
   * Synchronous count of actions accepted this session. The MAX_ACTIONS guard
   * used to live only inside the async `tail` callback, so a page firing
   * __aemRecord in a tight loop enqueued an unbounded chain of closures and a
   * burst of up-to-MAX screenshots before any completed. This bounds the flood
   * at the point of entry, before anything is scheduled.
   */
  private accepted = 0;

  isBusy(): boolean {
    return this.state?.status === "recording";
  }

  async start(
    title: string,
    startUrl: string,
    owner: string,
  ): Promise<RecorderState> {
    if (this.isBusy()) {
      throw new Error("A recording is already in progress.");
    }
    const sid = id("rec");
    this.accepted = 0;
    this.state = {
      id: sid,
      owner,
      status: "recording",
      title: title.trim() || "Untitled task",
      startUrl,
      actions: [],
      startedAt: Date.now(),
    };

    try {
    await mkdir(path.join(RECORDINGS_DIR, owner, sid), { recursive: true });

    // Headless - the user drives it remotely via the streamed view.
    // AEMULUS_RECORD_HEADED=1 opens a real window for local debugging.
    this.browser = await launchBrowser({
      headless: process.env.AEMULUS_RECORD_HEADED !== "1",
    });
    this.context = await this.browser.newContext({
      viewport: VIEWPORT,
      acceptDownloads: false,
    });

    // SSRF egress guard for the WHOLE session, not just the initial URL: an
    // in-page redirect/click to an internal host or a hostname that resolves
    // private would otherwise be loaded and screencast into the recording.
    await this.context.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      if (isUnsafeRequestUrl(url)) return route.abort();
      // Resolve the host and block anything pointing at a private/internal
      // address - for EVERY request, not just navigations. A subresource
      // (img/script/fetch) to a public hostname whose DNS points inside the
      // network would otherwise reach internal services / cloud metadata. The
      // check is host-cached (60s), so cost is one lookup per distinct host.
      if (await navHostResolvesPrivate(url)) return route.abort();
      return route.continue();
    });

    // Bridge: in-page script calls window.__aemRecord(action). Exposed on the
    // context, so it's reachable from ANY frame; only accept calls from the top
    // frame so a cross-origin sub-frame (ad/iframe) can't fabricate trace
    // actions. source.page is server-side and not page-spoofable.
    await this.context.exposeBinding(
      "__aemRecord",
      async (source, raw: RawAction) => {
        if (source.frame !== source.page.mainFrame()) return;
        this.enqueue(source.page, raw);
      },
    );
    await this.context.addInitScript(recorderInitScript);

    this.page = await this.context.newPage();
    this.context.on("close", () => { this.markStopped(); void this.closeBrowser(); });

    // Stream the page to the client via CDP screencast.
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (frame) => {
      this.lastFrame = frame.data;
      this.frameSeq++;
      try {
        await this.cdp?.send("Page.screencastFrameAck", {
          sessionId: frame.sessionId,
        });
      } catch {
        /* session may be tearing down */
      }
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    });

    await this.page.goto(startUrl, { waitUntil: "domcontentloaded" });
    // Seed the trace with the opening navigation + its screenshot.
    this.enqueue(this.page, { type: "navigate", value: startUrl });

    this.touch();
    return this.snapshot();
    } catch (e) {
      // Setup failed (bad/blocked startUrl, nav timeout, launch error): free the
      // browser and clear the session so the wallet isn't wedged and nothing leaks.
      await this.closeBrowser();
      this.state = null;
      throw e;
    }
  }

  /** Reset the idle timer on any activity; fires an auto-stop when it lapses. */
  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.markStopped();
      void this.closeBrowser();
    }, IDLE_MS);
  }

  /** Latest screencast frame for the live view (base64 jpeg). */
  getFrame(): { seq: number; data: string | null; url: string } {
    if (this.state?.status === "recording") this.touch(); // client is watching → keep alive
    return {
      seq: this.frameSeq,
      data: this.lastFrame,
      url: this.page ? safeUrl(this.page) : "",
    };
  }

  /** Forward a user input event from the streamed view to the page. */
  async dispatchInput(ev: InputEvent): Promise<void> {
    const page = this.page;
    if (!page || this.state?.status !== "recording") return;
    try {
      switch (ev.type) {
        case "click":
          await page.mouse.click(clamp(ev.x, VIEWPORT.width), clamp(ev.y, VIEWPORT.height));
          break;
        case "move":
          await page.mouse.move(clamp(ev.x, VIEWPORT.width), clamp(ev.y, VIEWPORT.height));
          break;
        case "scroll":
          await page.mouse.wheel(0, ev.dy);
          break;
        case "text":
          await page.keyboard.type(ev.text);
          break;
        case "key":
          await page.keyboard.press(ev.key);
          break;
      }
    } catch {
      /* page may be navigating; drop the event */
    }
  }

  /** Append an action, capturing a screenshot, serialized via `tail`. */
  private enqueue(page: Page, raw: RawAction) {
    // Validate + bound the (page-supplied) payload; drop anything malformed or
    // beyond the per-recording action cap.
    const parsed = RawActionSchema.safeParse(raw);
    if (!parsed.success) return;
    // Bound the flood synchronously, BEFORE scheduling any work: a page looping
    // __aemRecord can't grow the tail chain or trigger a screenshot burst past
    // the cap. `accepted` only increments, so once at the cap everything drops.
    if (!this.state || this.state.status !== "recording") return;
    if (this.accepted >= MAX_ACTIONS) return;
    this.accepted++;
    const safeRaw = parsed.data;
    this.tail = this.tail.then(async () => {
      if (!this.state || this.state.status !== "recording") return;
      if (this.state.actions.length >= MAX_ACTIONS) return;
      const idx = this.state.actions.length;
      const file = `step-${String(idx).padStart(4, "0")}.png`;
      const rel = path.posix.join("recordings", this.state.owner, this.state.id, file);
      try {
        await page.screenshot({
          path: path.join(RECORDINGS_DIR, this.state.owner, this.state.id, file),
        });
      } catch {
        // Page may be mid-navigation; keep the action without a screenshot.
      }
      const action: RecordedAction = {
        ...safeRaw,
        idx,
        ts: Date.now(),
        url: safeUrl(page),
        screenshot: rel,
      };
      this.state.actions.push(action);
    });
  }

  async stop(): Promise<RecorderState> {
    await this.tail.catch(() => {});
    this.markStopped();
    await this.closeBrowser();
    return this.snapshot();
  }

  private markStopped() {
    if (this.state && this.state.status === "recording") {
      this.state.status = "stopped";
    }
  }

  private async closeBrowser() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    try {
      await this.browser?.close();
    } catch {
      /* already gone */
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdp = null;
    this.lastFrame = null;
  }

  /** Serializable snapshot for API responses. */
  snapshot(): RecorderState {
    if (!this.state) {
      return {
        id: "",
        owner: "",
        status: "idle",
        title: "",
        startUrl: "",
        actions: [],
        startedAt: 0,
      };
    }
    return { ...this.state, actions: [...this.state.actions] };
  }

  markSaved(demonstrationId: string) {
    if (this.state) {
      this.state.status = "saved";
      this.state.demonstrationId = demonstrationId;
    }
  }
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(Math.round(v), max));
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

/**
 * Per-wallet recorder registry (globalThis-cached, HMR-safe). Each user gets
 * their own session, so many people can record at once - no global lock.
 */
declare global {
  var __aemRecorders: Map<string, RecorderSession> | undefined;
}
const registry: Map<string, RecorderSession> = (globalThis.__aemRecorders ??=
  new Map());

export function getRecorder(owner: string): RecorderSession {
  let r = registry.get(owner);
  if (!r) {
    r = new RecorderSession();
    registry.set(owner, r);
  }
  return r;
}
