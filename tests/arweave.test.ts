import { readFileSync } from "node:fs";
import { toArchiveBundle, type BatchBundle } from "../lib/receipt";
import { afterEach, describe, expect, it } from "vitest";
import { arweaveEnabled, arweaveUrl, storeBundle, FREE_LIMIT_BYTES } from "../lib/arweave";
import { storeBatch, storeMissingBatches } from "../lib/receipt-batch";

/**
 * Permanent proof storage.
 *
 * The guarantee that matters here is not that uploads succeed — it is that
 * nothing about this can break receipt batching. A batch is already valid and
 * verifiable offline; Arweave makes it outlive us, which is an addition to the
 * proof rather than a precondition for it.
 */

describe("arweaveEnabled", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
  });

  // Off by default, like anchoring and payouts: an unconfigured install writes
  // no Arweave ids rather than throwing on every batch.
  it("is off without a key", () => {
    expect(arweaveEnabled()).toBe(false);
  });

  it("is on with one", () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    expect(arweaveEnabled()).toBe(true);
  });
});

describe("arweaveUrl", () => {
  it("points at a gateway anyone can read without an account", () => {
    expect(arweaveUrl("abc123")).toBe("https://arweave.net/abc123");
  });
});

describe("storeBundle", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
  });

  it("does nothing, quietly, when storage is off", async () => {
    expect(await storeBundle("batch_1", { root: "abc" })).toBeNull();
  });

  // Turbo is free under 100 KiB and CHARGED above it. Crossing that line
  // silently would either fail against an empty balance or quietly spend money,
  // so an oversized bundle is skipped deliberately.
  it("refuses a bundle over the free-tier limit rather than paying for it", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    const huge = { leaves: Array.from({ length: 20_000 }, (_, i) => ({ h: `leaf${i}` })) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(FREE_LIMIT_BYTES);
    // Returns null WITHOUT attempting an upload — a malformed key would throw
    // if it got as far as constructing a signer.
    expect(await storeBundle("batch_big", huge)).toBeNull();
  });

  // The batcher calls this inline. If it could throw, an Arweave outage would
  // stop receipts being batched at all.
  // Generous timeout on purpose: this is the one test that actually imports the
  // Turbo SDK, which costs a couple of seconds cold. That import is now inside
  // the upload timeout rather than outside it, so the bound is real — but the
  // test still has to pay for it once.
  it("never throws, even with a completely invalid key", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "not json at all";
    await expect(storeBundle("batch_2", { root: "abc" })).resolves.toBeNull();
  }, 30_000);
});

describe("nothing worth storing", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
  });

  // buildBatchBundle returns null for an unknown batch, so this is reachable.
  // JSON.stringify(null) is the 4-byte string "null" — small enough to pass the
  // size check and be written to Arweave PERMANENTLY, signed by our wallet and
  // impossible to retract. Refusing is the only correct answer.
  it("refuses to permanently store a null bundle", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    expect(await storeBundle("batch_null", null)).toBeNull();
    expect(await storeBundle("batch_undef", undefined)).toBeNull();
  });

  it("refuses anything that is not an object", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    expect(await storeBundle("batch_str", "null")).toBeNull();
    expect(await storeBundle("batch_num", 0)).toBeNull();
  });
});

describe("storeBatch", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
  });

  it("does nothing when storage is off", async () => {
    expect(await storeBatch("batch_x")).toBeNull();
  });

  // It runs inside the batcher's tick. Building the bundle used to happen
  // OUTSIDE the error boundary, so a database blip threw straight out of
  // batching — the exact thing the design says cannot happen.
  it("swallows an unknown batch rather than throwing into the batcher", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "{}";
    await expect(storeBatch("batch_does_not_exist")).resolves.toBeNull();
  });
});

describe("storeMissingBatches", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
  });

  it("is a no-op when storage is off", async () => {
    expect(await storeMissingBatches()).toBe(0);
  });

  // A single failed upload must not mean that batch is silently never
  // permanent, which would quietly hollow out the whole claim.
  it("never throws, whatever the database or key does", async () => {
    process.env.AEMULUS_ARWEAVE_KEY = "not json";
    await expect(storeMissingBatches()).resolves.toBeTypeOf("number");
  });
});

describe("no import cycle", () => {
  // arweave.ts must stay a leaf: when it imported receipt.ts for the bundle
  // builder while receipt.ts imported it back for the gateway URL, the two
  // formed a cycle that only bites at module-init time — the kind of thing that
  // type-checks cleanly and fails in production.
  it("keeps arweave.ts free of receipt imports", () => {
    const src = readFileSync(new URL("../lib/arweave.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\/receipt/);
  });
});

describe("the sweep", () => {
  afterEach(() => {
    delete process.env.AEMULUS_ARWEAVE_KEY;
  });

  // An oversized bundle fails identically every time. Under an unbounded
  // newest-first sweep it would sit at the head forever and block every batch
  // behind it, so the sweep never makes progress again.
  it("bounds how far back it looks", async () => {
    const src = readFileSync(new URL("../lib/receipt-batch.ts", import.meta.url), "utf8");
    expect(src).toMatch(/created_at >= \?/);
    expect(src).toMatch(/SWEEP_WINDOW_MS/);
  });

  // Two overlapping sweeps would both select the same null-id batches and
  // upload each of them twice — permanently, and for real money past the free
  // tier.
  it("refuses to run on top of itself", async () => {
    const src = readFileSync(new URL("../lib/receipt-batch.ts", import.meta.url), "utf8");
    expect(src).toMatch(/sweeping/);
  });
});

describe("the archive form", () => {
  const bundleOf = (n: number): BatchBundle => ({
    batchId: "batch_1",
    root: "r".repeat(64),
    sig: null,
    cluster: null,
    leafCount: n,
    createdAt: 1_760_000_000_000,
    bundleHash: "b".repeat(64),
    leaves: Array.from({ length: n }, (_, i) => ({
      runId: `run_${i}`,
      leafHash: "h".repeat(64),
      leafIndex: i,
      proof: {
        siblings: Array.from({ length: Math.ceil(Math.log2(Math.max(2, n))) }, () => ({
          hash: "s".repeat(64),
          left: true,
        })),
      },
    })),
  });

  it("keeps everything a verifier needs to rebuild the tree", () => {
    const a = toArchiveBundle(bundleOf(4));
    expect(a.root).toBe("r".repeat(64));
    expect(a.bundleHash).toBe("b".repeat(64));
    // Order and index are what make the proofs derivable.
    expect(a.leaves.map((l) => l.i)).toEqual([0, 1, 2, 3]);
    expect(a.leaves.every((l) => l.h === "h".repeat(64))).toBe(true);
  });

  // Public forever. Nobody outside should be able to read off which runs are in
  // a batch; a verifier holding a receipt recomputes its hash and finds it.
  it("carries no run ids", () => {
    expect(JSON.stringify(toArchiveBundle(bundleOf(4)))).not.toContain("run_");
  });

  // The whole point. A full bundle at the batcher's 1000-leaf cap is ~1 MB —
  // past the free tier, so every busy batch was silently never stored.
  it("fits the free tier at the batcher's maximum batch size", () => {
    const full = Buffer.byteLength(JSON.stringify(bundleOf(1000)));
    const archived = Buffer.byteLength(JSON.stringify(toArchiveBundle(bundleOf(1000))));
    expect(full).toBeGreaterThan(FREE_LIMIT_BYTES);
    expect(archived).toBeLessThan(FREE_LIMIT_BYTES);
  });
});

describe("missing evidence is not tampering", () => {
  // A receipt commits to a hash of every proof screenshot, so a screenshot that
  // is gone from storage fails verification exactly like an edited one. Telling
  // someone their run "changed since it ran" when a file is simply missing
  // accuses them of tampering over what is almost always lost storage — and it
  // is the first thing they will report as a bug.
  it("reports missing screenshots separately from a mismatch", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { default: path } = await import("node:path");
    const { db, ready } = await import("../lib/db");
    const { createSkill } = await import("../lib/skills");
    const { attachReceipt, verifyReceipt } = await import("../lib/receipt");
    const { DATA_ROOT } = await import("../lib/paths");

    await ready();
    const skill = await createSkill({
      owner: "o_missing",
      generalized: { name: "T", description: "", inputFields: [], steps: [] },
      sourceDemoId: null,
    });

    const runId = "run_missing_shot";
    const rel = path.join("recordings", "missing", "step-0000.png");
    const abs = path.join(DATA_ROOT, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from("proof pixels"));

    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO runs (id, owner, skill_id, status, input, created_at, updated_at)
            VALUES (?, 'o_missing', ?, 'completed', '{}', ?, ?)`,
      args: [runId, skill.id, now, now],
    });
    await db.execute({
      sql: `INSERT INTO run_steps (id, run_id, idx, intent, action, screenshot, confidence, flagged, note, created_at)
            VALUES (?, ?, 0, '', 'click', ?, 1, 0, '', ?)`,
      args: [`st_${runId}`, runId, rel, now],
    });

    await attachReceipt(runId);
    expect((await verifyReceipt(runId)).matches).toBe(true);

    // Exactly what an ephemeral filesystem does on redeploy.
    rmSync(abs);

    const after = await verifyReceipt(runId);
    expect(after.matches).toBe(false);
    expect(after.missingShots).toBe(1);
  });

  // A genuine edit must still read as an edit, or the softer wording would
  // become a way to hide tampering.
  it("does not claim missing evidence when the data was actually changed", async () => {
    const { db, ready } = await import("../lib/db");
    const { createSkill } = await import("../lib/skills");
    const { attachReceipt, verifyReceipt } = await import("../lib/receipt");

    await ready();
    const skill = await createSkill({
      owner: "o_edit",
      generalized: { name: "T", description: "", inputFields: [], steps: [] },
      sourceDemoId: null,
    });
    const runId = "run_edited";
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO runs (id, owner, skill_id, status, input, created_at, updated_at)
            VALUES (?, 'o_edit', ?, 'completed', '{}', ?, ?)`,
      args: [runId, skill.id, now, now],
    });
    await db.execute({
      sql: `INSERT INTO run_steps (id, run_id, idx, intent, action, screenshot, confidence, flagged, note, created_at)
            VALUES (?, ?, 0, '', 'click', '', 1, 0, '', ?)`,
      args: [`st_${runId}`, runId, now],
    });
    await attachReceipt(runId);

    // Change the run itself, leaving every screenshot exactly where it was.
    await db.execute({
      sql: `UPDATE runs SET status = 'failed' WHERE id = ?`,
      args: [runId],
    });

    const after = await verifyReceipt(runId);
    expect(after.matches).toBe(false);
    expect(after.missingShots).toBeUndefined();
  });
});
