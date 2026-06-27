import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { id } from "./ids";
import { recorderInitScript } from "./recorder-inject";
import type { RecordedAction, RecorderState } from "./types";

/**
 * Server-side recorder. Launches a HEADLESS Chromium, streams its screen to the
 * browser via CDP screencast, and forwards the user's mouse/keyboard back via
 * Playwright (which dispatches trusted DOM events) — so it works for a remote
 * user on a hosted deploy, not just on localhost. The injected script still
 * reports each interaction, building the trace exactly as before.
 *
 * Exactly one session is active at a time. The instance is cached on
 * globalThis so Next.js hot-reload doesn't orphan a live browser.
 */

const RECORDINGS_DIR = path.join(process.cwd(), ".data", "recordings");
const VIEWPORT = { width: 1280, height: 800 };

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
  /** Serializes screenshot+trace writes so indexes never race. */
  private tail: Promise<void> = Promise.resolve();

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
    this.state = {
      id: sid,
      owner,
      status: "recording",
      title: title.trim() || "Untitled task",
      startUrl,
      actions: [],
      startedAt: Date.now(),
    };

    await mkdir(path.join(RECORDINGS_DIR, owner, sid), { recursive: true });

    // Headless — the user drives it remotely via the streamed view.
    // MIMIC_RECORD_HEADED=1 opens a real window for local debugging.
    this.browser = await chromium.launch({
      headless: process.env.MIMIC_RECORD_HEADED !== "1",
    });
    this.context = await this.browser.newContext({ viewport: VIEWPORT });

    // Bridge: in-page script calls window.__mimicRecord(action).
    await this.context.exposeBinding(
      "__mimicRecord",
      async (source, raw: RawAction) => {
        this.enqueue(source.page, raw);
      },
    );
    await this.context.addInitScript(recorderInitScript);

    this.page = await this.context.newPage();
    this.context.on("close", () => this.markStopped());

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

    return this.snapshot();
  }

  /** Latest screencast frame for the live view (base64 jpeg). */
  getFrame(): { seq: number; data: string | null; url: string } {
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
    this.tail = this.tail.then(async () => {
      if (!this.state || this.state.status !== "recording") return;
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
        ...raw,
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
 * their own session, so many people can record at once — no global lock.
 */
declare global {
  var __mimicRecorders: Map<string, RecorderSession> | undefined;
}
const registry: Map<string, RecorderSession> = (globalThis.__mimicRecorders ??=
  new Map());

export function getRecorder(owner: string): RecorderSession {
  let r = registry.get(owner);
  if (!r) {
    r = new RecorderSession();
    registry.set(owner, r);
  }
  return r;
}
