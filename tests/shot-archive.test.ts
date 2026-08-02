import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shotsEnabled } from "../lib/arweave";
import { shotUrl, SWEEP_BUDGET_BYTES, archiveRunShots, sweepShots } from "../lib/shot-archive";
import { hashScreenshot } from "../lib/receipt";
import { DATA_ROOT } from "../lib/paths";

/**
 * Permanent screenshot storage.
 *
 * Two properties matter more than whether uploads succeed: it must never store
 * a screenshot nobody asked it to store, and it must never break a run.
 * Arweave has no delete, so the first mistake is not recoverable.
 */

describe("the switch", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
    delete process.env.AEMULUS_ARWEAVE_SHOTS;
  });

  it("is off by default", () => {
    expect(shotsEnabled()).toBe(false);
  });

  // Receipts are hashes: public already, and free. Screenshots are the pixels
  // of a logged-in page and cost money. Switching the first on must never drag
  // the second along with it.
  it("does not come on just because receipt storage did", () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    expect(shotsEnabled()).toBe(false);
  });

  it("needs both switches", () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    process.env.AEMULUS_ARWEAVE_SHOTS = "1";
    expect(shotsEnabled()).toBe(true);
  });

  // Without a key there is nothing to sign with, so the shots flag alone must
  // not be read as consent to anything.
  it("stays off with the flag but no key", () => {
    process.env.AEMULUS_ARWEAVE_SHOTS = "1";
    expect(shotsEnabled()).toBe(false);
  });
});

describe("archiving without consent", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
    delete process.env.AEMULUS_ARWEAVE_SHOTS;
  });

  it("stores nothing at all when the feature is off", async () => {
    const r = await archiveRunShots("run_whatever");
    expect(r).toEqual({ stored: 0, deduped: 0, bytes: 0, deferred: 0 });
  });

  // The run does not exist, let alone carry an opt-in. This must be a quiet
  // no-op rather than an exception reaching run settlement.
  it("never throws on an unknown run", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    process.env.AEMULUS_ARWEAVE_SHOTS = "1";
    await expect(archiveRunShots("run_does_not_exist")).resolves.toBeTruthy();
  });

  it("never throws from the sweep", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "not json";
    process.env.AEMULUS_ARWEAVE_SHOTS = "1";
    await expect(sweepShots()).resolves.toBeTruthy();
  });
});

describe("hash agreement", () => {
  // The upload is tagged with the screenshot's hash, and that tag is the only
  // way anyone gets from a receipt to the image without our database. If the
  // archiver ever hashed differently from the receipt, discovery would break
  // silently and permanently — every upload tagged with a hash no receipt
  // mentions.
  it("hashes a screenshot exactly the way the receipt does", async () => {
    const rel = path.join("recordings", "hash_check", "step-0000.png");
    const abs = path.join(DATA_ROOT, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    const bytes = Buffer.from("not really a png, but bytes are bytes");
    writeFileSync(abs, bytes);

    const fromReceipt = await hashScreenshot(rel);
    const direct = createHash("sha256").update(bytes).digest("hex");
    expect(fromReceipt).toBe(direct);
  });
});

describe("bounds", () => {
  it("caps what a single sweep will spend", () => {
    expect(SWEEP_BUDGET_BYTES).toBeGreaterThan(0);
    // An automated batcher making paid uploads with no ceiling is how a balance
    // empties overnight.
    expect(SWEEP_BUDGET_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it("points at a gateway anyone can read without an account", () => {
    expect(shotUrl("tx123")).toBe("https://arweave.net/tx123");
  });
});
