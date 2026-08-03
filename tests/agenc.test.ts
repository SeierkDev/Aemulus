import { describe, expect, it } from "vitest";
import {
  canonicalOutputs,
  outputVector,
  OUTPUT_ARITY,
  SLOTS,
  SDK_VERSION,
  commitRun,
  verifyConstraintHash,
} from "../lib/agenc";
import { readFileSync } from "node:fs";

/**
 * AgenC interop.
 *
 * The constraint hash is only worth anything if somebody else can recompute it
 * from public data and get the same number. So these tests are about
 * determinism and about the encoding never depending on an accident.
 */

// BN254 scalar field, written as a constructor call because the TS target
// predates bigint literals.
const MOD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

const run = (over: Partial<Parameters<typeof outputVector>[0]> = {}) => ({
  id: "run_a1b2c3",
  skillId: "skl_x",
  skillVersion: 4,
  status: "completed",
  outcomeStatus: "achieved",
  outputs: { total: "$482.00", status: "Paid" },
  ...over,
});

describe("canonical encoding", () => {
  // Key order is an accident of how an object was built. The hash must not
  // depend on an accident, or two honest parties disagree.
  it("sorts keys so two encoders agree", () => {
    expect(canonicalOutputs({ b: "2", a: "1" })).toBe(canonicalOutputs({ a: "1", b: "2" }));
  });

  it("distinguishes an absent output set from an empty one only by being stable", () => {
    expect(canonicalOutputs(null)).toBe("{}");
    expect(canonicalOutputs({})).toBe("{}");
  });

  it("changes when a value changes", () => {
    expect(canonicalOutputs({ a: "1" })).not.toBe(canonicalOutputs({ a: "2" }));
  });
});

describe("the output vector", () => {
  // Their circuit throws on anything but four. This is not a preference.
  it("is exactly four field elements", () => {
    expect(outputVector(run(), MOD)).toHaveLength(OUTPUT_ARITY);
    expect(SLOTS).toHaveLength(OUTPUT_ARITY);
  });

  it("keeps every element inside the BN254 scalar field", () => {
    for (const v of outputVector(run(), MOD)) {
      expect(v).toBeGreaterThanOrEqual(BigInt(0));
      expect(v).toBeLessThan(MOD);
    }
  });

  it("is deterministic", () => {
    expect(outputVector(run(), MOD)).toEqual(outputVector(run(), MOD));
  });

  // Each slot has to actually carry its field, or the hash silently stops
  // distinguishing runs it should distinguish.
  it("changes when any of the four inputs changes", () => {
    const base = outputVector(run(), MOD);
    for (const change of [
      { id: "run_other" },
      { skillId: "skl_other" },
      { outputs: { total: "$99.00", status: "Paid" } },
      { status: "failed" },
    ]) {
      expect(outputVector(run(change), MOD)).not.toEqual(base);
    }
  });

  // A run that healed into v5 is not the same run as one that executed v4, and
  // an unversioned run must not collide with version 1.
  it("separates versions, including unversioned", () => {
    const v4 = outputVector(run({ skillVersion: 4 }), MOD);
    expect(outputVector(run({ skillVersion: 5 }), MOD)).not.toEqual(v4);
    expect(outputVector(run({ skillVersion: null }), MOD)).not.toEqual(
      outputVector(run({ skillVersion: 1 }), MOD),
    );
  });
});

describe("the private witness", () => {
  // Their SDK: the witness "must be a secret known only to the agent" — it
  // derives the nullifier that stops somebody front-running a proof. A value
  // built only from the run id and the wallet would be known to everyone, since
  // both are printed on the public verify page.
  it("does not produce a commitment without server secret material", async () => {
    const prev = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      const c = await commitRun({ ...run(), owner: "11111111111111111111111111111111" });
      // The public half still works: the constraint hash needs no secret.
      expect(c!.constraintHash).toMatch(/^[0-9a-f]+$/);
      // The private half fails closed rather than minting a guessable witness.
      expect(c!.outputCommitment).toBeNull();
      expect(c!.salt).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  }, 30_000);

  it("produces one when there is", async () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "test-secret-material";
    try {
      const c = await commitRun({ ...run(), owner: "11111111111111111111111111111111" });
      expect(c!.outputCommitment).toMatch(/^[0-9a-f]+$/);
      expect(c!.salt).toMatch(/^[0-9a-f]+$/);
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  }, 30_000);

  // The witness must move with the secret, or it was never a witness.
  it("changes the commitment when the secret changes", async () => {
    const prev = process.env.AUTH_SECRET;
    const owner = "11111111111111111111111111111111";
    try {
      process.env.AUTH_SECRET = "secret-a";
      const a = await commitRun({ ...run(), owner });
      process.env.AUTH_SECRET = "secret-b";
      const b = await commitRun({ ...run(), owner });
      expect(a!.outputCommitment).not.toBe(b!.outputCommitment);
      // ...while the public number stays the same, since it uses no secret.
      expect(a!.constraintHash).toBe(b!.constraintHash);
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  }, 30_000);
});

describe("committing a run", () => {
  it("produces a hash anyone can recompute from the same data", async () => {
    const r = { ...run(), owner: "11111111111111111111111111111111" };
    const c = await commitRun(r);
    expect(c).toBeTruthy();
    expect(c!.constraintHash).toMatch(/^[0-9a-f]+$/);
    // The point of using their canonical hashing rather than our own: a third
    // party can check us without asking us anything.
    expect(await verifyConstraintHash(r, c!.constraintHash)).toBe(true);
  }, 30_000);

  it("gives a different hash when the outputs differ", async () => {
    const owner = "11111111111111111111111111111111";
    const a = await commitRun({ ...run(), owner });
    const b = await commitRun({ ...run({ outputs: { total: "$1.00" } }), owner });
    expect(a!.constraintHash).not.toBe(b!.constraintHash);
  }, 30_000);

  // A fresh salt per run: their SDK is explicit that reuse across commitments
  // with different outputs leaks information about those outputs.
  it("never reuses a salt", async () => {
    const owner = "11111111111111111111111111111111";
    const a = await commitRun({ ...run(), owner });
    const b = await commitRun({ ...run(), owner });
    expect(a!.salt).not.toBe(b!.salt);
    // Same inputs, same public hash — only the hiding part moves.
    expect(a!.constraintHash).toBe(b!.constraintHash);
  }, 30_000);

  // It runs beside receipt attachment. It may cost an interop field; it may
  // never cost the receipt.
  it("degrades instead of throwing on a wallet it cannot parse", async () => {
    const c = await commitRun({ ...run(), owner: "not-a-wallet" });
    // The vector is built from the run, the skill, the outputs and the outcome —
    // no wallet anywhere in it — so an unparseable owner has no business costing
    // the interop number. Only the commitment, which needs an agent key, drops.
    expect(c!.constraintHash).toMatch(/^[0-9a-f]+$/);
    expect(c!.outputCommitment).toBeNull();
  }, 30_000);
});

describe("the SDK version is pinned", () => {
  // These hashes are sealed into receipts, anchored on Solana and written to
  // Arweave. If a minor release changed the hash function, a fresh install would
  // silently start producing different numbers for the same run and every stored
  // hash would stop verifying, with nothing to say why. So a bump has to break a
  // test and be decided on, rather than arrive with an install.
  it("matches the version the stored hashes were computed with", () => {
    // Read off disk: their package.json is not reachable through the exports map.
    const installed = JSON.parse(
      readFileSync("node_modules/@tetsuo-ai/sdk/package.json", "utf8"),
    ).version;
    expect(installed).toBe(SDK_VERSION);
  });

  it("is pinned exactly in package.json, not a range", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const spec = pkg.dependencies["@tetsuo-ai/sdk"];
    expect(spec).toBe(SDK_VERSION);
    // A caret or tilde here is what would let the hash function change under us.
    expect(spec).not.toMatch(/[\^~*x]/);
  });
});
