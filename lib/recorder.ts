import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { id } from "./ids";
import { recorderInitScript } from "./recorder-inject";
import type { RecordedAction, RecorderState } from "./types";

/**
 * Server-side recorder. Launches a real (headed) Chromium window the user
 * drives directly; an injected script reports every meaningful interaction
 * back to Node, where we attach a proof screenshot and append to the trace.
 *
 * Exactly one session is active at a time. The instance is cached on
 * globalThis so Next.js hot-reload doesn't orphan a live browser.
 */

const RECORDINGS_DIR = path.join(process.cwd(), ".data", "recordings");

/** Payload the in-page script sends; Node enriches it into a RecordedAction. */
type RawAction = Omit<RecordedAction, "idx" | "ts" | "url" | "screenshot">;

class RecorderSession {
  state: RecorderState | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  /** Serializes screenshot+trace writes so indexes never race. */
  private tail: Promise<void> = Promise.resolve();

  isBusy(): boolean {
    return this.state?.status === "recording";
  }

  async start(title: string, startUrl: string): Promise<RecorderState> {
    if (this.isBusy()) {
      throw new Error("A recording is already in progress.");
    }
    const sid = id("rec");
    this.state = {
      id: sid,
      status: "recording",
      title: title.trim() || "Untitled task",
      startUrl,
      actions: [],
      startedAt: Date.now(),
    };

    await mkdir(path.join(RECORDINGS_DIR, sid), { recursive: true });

    // Headed by default (the user drives it). MIMIC_HEADLESS=1 for tests/CI.
    this.browser = await chromium.launch({
      headless: process.env.MIMIC_HEADLESS === "1",
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    // Bridge: in-page script calls window.__mimicRecord(action).
    await this.context.exposeBinding(
      "__mimicRecord",
      async (source, raw: RawAction) => {
        this.enqueue(source.page, raw);
      },
    );
    await this.context.addInitScript(recorderInitScript);

    this.page = await this.context.newPage();

    // If the user closes the window, end the session cleanly.
    this.context.on("close", () => this.markStopped());

    await this.page.goto(startUrl, { waitUntil: "domcontentloaded" });
    // Seed the trace with the opening navigation + its screenshot.
    this.enqueue(this.page, { type: "navigate", value: startUrl });

    return this.snapshot();
  }

  /** Append an action, capturing a screenshot, serialized via `tail`. */
  private enqueue(page: Page, raw: RawAction) {
    this.tail = this.tail.then(async () => {
      if (!this.state || this.state.status !== "recording") return;
      const idx = this.state.actions.length;
      const file = `step-${String(idx).padStart(4, "0")}.png`;
      const rel = path.posix.join("recordings", this.state.id, file);
      try {
        await page.screenshot({
          path: path.join(RECORDINGS_DIR, this.state.id, file),
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
  }

  /** Serializable snapshot for API responses. */
  snapshot(): RecorderState {
    if (!this.state) {
      return {
        id: "",
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

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

/** globalThis-cached singleton (survives HMR in dev). */
declare global {
  var __mimicRecorder: RecorderSession | undefined;
}
export const recorder: RecorderSession =
  globalThis.__mimicRecorder ?? (globalThis.__mimicRecorder = new RecorderSession());
