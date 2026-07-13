import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  rrwebEnabled,
  rrwebPath,
  hasRrwebEvents,
  saveRrwebEvents,
} from "../../lib/rrweb-capture";

const OWNER = "WALLET_RRWEB";
const RUN = "run_rrweb_1";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rrweb-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("rrwebEnabled", () => {
  it("is gated on AEMULUS_RRWEB=1 and inert otherwise", () => {
    const prev = process.env.AEMULUS_RRWEB;
    process.env.AEMULUS_RRWEB = "1";
    expect(rrwebEnabled()).toBe(true);
    process.env.AEMULUS_RRWEB = "0";
    expect(rrwebEnabled()).toBe(false);
    delete process.env.AEMULUS_RRWEB;
    expect(rrwebEnabled()).toBe(false);
    if (prev !== undefined) process.env.AEMULUS_RRWEB = prev;
  });
});

describe("rrweb event persistence", () => {
  it("save → has → serve roundtrips as gzipped JSON", async () => {
    await mkdir(path.join(dir, OWNER, RUN), { recursive: true });
    expect(hasRrwebEvents(dir, OWNER, RUN)).toBe(false);

    const events = [
      { type: 4, data: { width: 1280, height: 800 }, timestamp: 1 },
      { type: 2, data: { node: {} }, timestamp: 2 },
      { type: 3, data: { source: 0 }, timestamp: 3 },
    ];
    await saveRrwebEvents(dir, OWNER, RUN, events);

    expect(hasRrwebEvents(dir, OWNER, RUN)).toBe(true);
    const gz = await readFile(rrwebPath(dir, OWNER, RUN));
    const decoded = JSON.parse(gunzipSync(gz).toString("utf8"));
    expect(decoded).toHaveLength(3);
    expect(decoded[0].type).toBe(4);
  });

  it("skips empty / too-short streams", async () => {
    await mkdir(path.join(dir, OWNER, "run_empty"), { recursive: true });
    await saveRrwebEvents(dir, OWNER, "run_empty", []);
    await saveRrwebEvents(dir, OWNER, "run_empty", [{ type: 4, data: {}, timestamp: 1 }]);
    expect(hasRrwebEvents(dir, OWNER, "run_empty")).toBe(false);
  });
});
