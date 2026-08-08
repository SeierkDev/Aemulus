import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  pickActions,
  visionContent,
  visionSynthesisEnabled,
  visionShots,
  resolveShot,
} from "../lib/vision";
import { DATA_ROOT } from "../lib/paths";
import type { Demonstration, RecordedAction } from "../lib/types";

const act = (idx: number, type: string, extra: Partial<RecordedAction> = {}): RecordedAction =>
  ({ idx, type, url: "https://x.test", ts: 0, screenshot: `recordings/o/d/step-${idx}.png`, ...extra }) as RecordedAction;

describe("pickActions", () => {
  it("skips navigations — a page nobody has touched shows little", () => {
    const trace = [act(0, "navigate"), act(1, "click"), act(2, "input")];
    expect(pickActions(trace, 4).map((a) => a.idx)).toEqual([1, 2]);
  });

  it("never sends a screenshot of a secret field", () => {
    // The value is already redacted, but the frame still shows the form with
    // whatever was typed into it visible on screen.
    const trace = [act(1, "input", { sensitive: true }), act(2, "click")];
    expect(pickActions(trace, 4).map((a) => a.idx)).toEqual([2]);
  });

  it("skips actions with no screenshot", () => {
    const trace = [act(1, "click", { screenshot: undefined }), act(2, "click")];
    expect(pickActions(trace, 4).map((a) => a.idx)).toEqual([2]);
  });

  it("samples across the whole recording rather than taking the first N", () => {
    // Taking the first N would show the login every time and never the thing
    // the task was actually for.
    const trace = Array.from({ length: 20 }, (_, i) => act(i + 1, "click"));
    const got = pickActions(trace, 4).map((a) => a.idx);
    expect(got).toHaveLength(4);
    expect(got[0]).toBe(1);
    expect(got[got.length - 1]).toBe(20);
    expect([...got].sort((a, b) => a - b)).toEqual(got); // in order
  });

  it("falls back to one frame when a recording is nothing but navigation", () => {
    const trace = [act(0, "navigate"), act(1, "navigate")];
    expect(pickActions(trace, 4).map((a) => a.idx)).toEqual([1]);
  });

  it("returns nothing when the budget is zero", () => {
    expect(pickActions([act(1, "click")], 0)).toEqual([]);
  });

  it("handles a budget of exactly one", () => {
    // The even-spacing formula divides by (max - 1), so max === 1 produced
    // pool[NaN] — an undefined action that then threw on .screenshot and, from
    // inside the catch, escaped and failed the whole generalize.
    const trace = Array.from({ length: 12 }, (_, i) => act(i + 1, "click"));
    const got = pickActions(trace, 1);
    expect(got).toHaveLength(1);
    expect(got[0]).toBeDefined();
    expect(got[0].idx).toBe(12); // the last value-bearing step
  });

  it("never yields an undefined entry at any budget", () => {
    const trace = Array.from({ length: 25 }, (_, i) => act(i + 1, "click"));
    for (let max = 1; max <= 8; max++) {
      const got = pickActions(trace, max);
      expect(got.every(Boolean)).toBe(true);
      expect(got.length).toBeGreaterThan(0);
    }
  });

  it("does not repeat an action when the pool is smaller than the budget", () => {
    const trace = [act(1, "click"), act(2, "click")];
    const got = pickActions(trace, 4).map((a) => a.idx);
    expect(new Set(got).size).toBe(got.length);
  });
});

describe("visionShots", () => {
  const KEY = "AEMULUS_VISION_SHOTS";
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("honours a deliberate zero", () => {
    // `Number(raw) || 4` read 0 as unset and handed back 4 — the one value an
    // operator would use to turn frames off did the opposite.
    process.env[KEY] = "0";
    expect(visionShots()).toBe(0);
  });

  it("defaults when unset or unparseable", () => {
    delete process.env[KEY];
    expect(visionShots()).toBe(4);
    process.env[KEY] = "banana";
    expect(visionShots()).toBe(4);
  });

  it("clamps to a sane range", () => {
    process.env[KEY] = "99";
    expect(visionShots()).toBe(8);
    process.env[KEY] = "-3";
    expect(visionShots()).toBe(0);
    process.env[KEY] = " 2 ";
    expect(visionShots()).toBe(2);
  });
});

describe("resolveShot", () => {
  // Not exploitable today: the extension route rebuilds each action from a
  // whitelist that omits `screenshot`, and the server recorder sets the path
  // itself. Guarded because the feature turned a trace field into a file read
  // whose contents go to a third-party API.
  it("accepts a path inside the recordings tree", () => {
    expect(resolveShot("recordings/owner/demo/step-0001.png")).toContain(
      path.join("recordings", "owner", "demo"),
    );
  });

  it("refuses traversal out of the tree", () => {
    for (const bad of [
      "../../../../etc/passwd",
      "recordings/../../secrets.env",
      "recordings/a/../../../.data/aemulus.db",
      "/etc/passwd",
    ]) {
      expect(resolveShot(bad)).toBeNull();
    }
  });

  it("refuses anything outside recordings, even inside the data root", () => {
    expect(resolveShot("runs/owner/run/step.png")).toBeNull();
  });

  it("refuses empty and non-strings", () => {
    expect(resolveShot("")).toBeNull();
    expect(resolveShot(undefined as unknown as string)).toBeNull();
  });
});

describe("visionContent", () => {
  const KEY = "AEMULUS_VISION_SYNTHESIS";
  const saved = process.env[KEY];
  let dir = "";

  beforeEach(async () => {
    dir = path.join(DATA_ROOT, "recordings", "vtest");
    await mkdir(dir, { recursive: true });
    // A one-pixel PNG — enough for the media-type sniff to read it.
    await writeFile(
      path.join(dir, "step-1.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
    await rm(dir, { recursive: true, force: true });
  });

  const demo = (trace: RecordedAction[]): Demonstration =>
    ({ id: "d", owner: "o", title: "t", startUrl: null, trace, createdAt: 0 }) as Demonstration;

  it("emits a label and an image per readable screenshot", async () => {
    const r = await visionContent(demo([act(1, "click", { screenshot: "recordings/vtest/step-1.png" })]));
    expect(r.shownIdx).toEqual([1]);
    expect(r.blocks).toHaveLength(2);
    expect((r.blocks[0] as { type: string }).type).toBe("text");
    expect((r.blocks[1] as { type: string }).type).toBe("image");
  });

  it("skips a screenshot it cannot read instead of failing the generalize", async () => {
    // A pruned recording, or one from the extension with no proof shot, still
    // has to produce a skill. Vision improves synthesis; it never gates it.
    const r = await visionContent(
      demo([
        act(1, "click", { screenshot: "recordings/vtest/step-1.png" }),
        act(2, "click", { screenshot: "recordings/vtest/gone.png" }),
      ]),
    );
    expect(r.shownIdx).toEqual([1]);
  });

  it("is off when the flag says off", async () => {
    process.env[KEY] = "0";
    expect(visionSynthesisEnabled()).toBe(false);
    const r = await visionContent(demo([act(1, "click", { screenshot: "recordings/vtest/step-1.png" })]));
    expect(r.blocks).toEqual([]);
    expect(r.shownIdx).toEqual([]);
  });

  it("is on by default", () => {
    delete process.env[KEY];
    expect(visionSynthesisEnabled()).toBe(true);
    expect(visionShots()).toBeGreaterThan(0);
  });
});

describe("the blocks are shaped the way the API expects", () => {
  // There is no API key in CI, so the request shape cannot be verified by
  // sending one. These assertions plus the SDK types on VisionContent.blocks
  // are the strongest offline check available: a malformed block is the one
  // fault that would break EVERY generalize rather than a single recording.
  it("pairs a label with each image, label first", async () => {
    const dir = path.join(DATA_ROOT, "recordings", "vshape");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "step-1.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    try {
      const r = await visionContent({
        id: "d",
        owner: "o",
        title: "t",
        startUrl: null,
        createdAt: 0,
        trace: [act(1, "click", { screenshot: "recordings/vshape/step-1.png" })],
      } as Demonstration);

      expect(r.blocks).toHaveLength(2);
      const [label, image] = r.blocks as [
        { type: string; text: string },
        { type: string; source: { type: string; media_type: string; data: string } },
      ];
      expect(label).toEqual({ type: "text", text: "Screenshot of step 1 (click):" });
      expect(image.type).toBe("image");
      expect(image.source.type).toBe("base64");
      // Declared from the bytes, not assumed — see lib/claude.ts.
      expect(image.source.media_type).toBe("image/png");
      expect(image.source.data.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
