import { createHash } from "node:crypto";
import { logError } from "./log";

/**
 * AgenC interop: a canonical constraint hash for every run.
 *
 * Aemulus already proves what a run returned, but only by revealing it — the
 * disclosure in lib/commitment.ts hands over the value along with its proof. So
 * the people doing the work most worth proving (invoices, balances, anything
 * inside a client's systems) can prove nothing at all.
 *
 * AgenC's SDK is the missing engine: a BN254 constraint hash over a fixed
 * four-element output vector, an output commitment hiding those values behind a
 * salt, and a RISC Zero proof their on-chain router verifies. This module owns
 * the part that needs no network: turning a run into that vector and computing
 * the hash exactly the way their protocol does.
 *
 * Everything here is deterministic. Two people WITH THE SAME RUN DATA compute
 * the same constraint hash, on different machines, with no shared state — which
 * is the only reason the number is worth anything. Someone without the data
 * cannot, by design: one of the four elements digests the outputs, and those
 * stay private.
 */

/**
 * Their circuit takes EXACTLY four field elements. Not a style choice on our
 * side: computeConstraintHash throws on any other length, which is how this
 * layout came to exist at all.
 *
 * The four slots are fixed and ordered, because the hash is order-sensitive:
 *
 *   0  who ran      run id
 *   1  what ran     skill id and the version that actually executed
 *   2  what came back   canonical digest of the run's outputs
 *   3  how it ended     status and the outcome verdict
 *
 * Anyone can rebuild this from a public receipt and check our number.
 */
/**
 * A field element as fixed-width hex.
 *
 * bigint.toString(16) drops leading zeros, so roughly one hash in sixteen comes
 * out 63 characters instead of 64 — and the whole point of using AgenC's
 * canonical hashing is that somebody else can recompute it with their SDK and
 * compare. They will pad to the field width; an unpadded string then fails a
 * comparison that should have succeeded. Observed on a live run:
 * d13bca…84cff, 63 characters.
 */
function fieldHex(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

export const OUTPUT_ARITY = 4;

/**
 * The SDK version these hashes were computed with, pinned exactly in
 * package.json rather than a caret range.
 *
 * A constraint hash is sealed into a receipt, batched, anchored on Solana and
 * written to Arweave — permanently. If a minor release changed the hash
 * function, a fresh deploy would start producing different numbers for the same
 * run and every stored hash would quietly stop verifying, with nothing to
 * indicate why. So the bump has to be a decision somebody makes, not something
 * an install does. A test fails if the installed version drifts from this.
 */
export const SDK_VERSION = "1.4.0";

/** Slot names, exported so a verifier can see the layout rather than infer it. */
export const SLOTS = ["run", "skill", "outputs", "outcome"] as const;

/**
 * Map arbitrary text into the BN254 scalar field.
 *
 * sha256 gives 256 bits and the field is slightly under 2^254, so reducing is
 * required. The tiny modulo bias is irrelevant here: this is a domain-separated
 * identifier, not a secret and not a nonce.
 */
function toField(domain: string, value: string, modulus: bigint): bigint {
  const h = createHash("sha256").update(`aemulus:${domain}:${value}`).digest("hex");
  return BigInt(`0x${h}`) % modulus;
}

/**
 * Canonical JSON for a run's outputs: keys sorted, so two encoders agree.
 * An object's key order is an accident of how it was built, and the hash must
 * not depend on an accident.
 */
export function canonicalOutputs(outputs: Record<string, string> | null): string {
  if (!outputs) return "{}";
  const keys = Object.keys(outputs).sort();
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, outputs[k]])));
}

/** The four field elements for a run, in the fixed order above. */
export function outputVector(
  run: {
    id: string;
    skillId: string;
    skillVersion?: number | null;
    status: string;
    outcomeStatus?: string | null;
    outputs: Record<string, string> | null;
  },
  modulus: bigint,
): bigint[] {
  return [
    toField("run", run.id, modulus),
    toField("skill", `${run.skillId}@${run.skillVersion ?? "unversioned"}`, modulus),
    toField("outputs", canonicalOutputs(run.outputs), modulus),
    toField("outcome", `${run.status}/${run.outcomeStatus ?? "unchecked"}`, modulus),
  ];
}

export interface AgencCommitment {
  /**
   * Constraint hash, hex. A public commitment to a private result: it is
   * recomputable by the OWNER, or by anyone the owner shows the run to, because
   * the vector includes a digest of the outputs and those are not public.
   * That is the point rather than a limitation.
   */
  constraintHash: string;
  /** Hiding commitment over the outputs. Null when there is no secret material
   *  to derive a witness from. Reveals nothing without the salt. */
  outputCommitment: string | null;
  /** Salt, hex. Secret: with it, the commitment stops hiding. */
  salt: string | null;
}

/**
 * Compute a run's AgenC constraint hash and hiding commitment.
 *
 * Returns null rather than throwing. This runs alongside receipt attachment and
 * must never be able to stop a run settling — a missing constraint hash costs
 * an interop field, an exception would cost the receipt.
 *
 * The AgenC SDK and web3.js are imported lazily so their dependency graphs stay
 * out of memory on every path that never computes a commitment. This module
 * itself only pulls in node:crypto.
 */
export async function commitRun(run: {
  id: string;
  owner: string;
  skillId: string;
  skillVersion?: number | null;
  status: string;
  outcomeStatus?: string | null;
  outputs: Record<string, string> | null;
}): Promise<AgencCommitment | null> {
  try {
    const { computeConstraintHash, computeHashes, generateSalt, FIELD_MODULUS } =
      await import("@tetsuo-ai/sdk");
    const { PublicKey } = await import("@solana/web3.js");

    const vector = outputVector(run, FIELD_MODULUS);
    if (vector.length !== OUTPUT_ARITY) return null;

    // The constraint hash needs no secret at all. Computed on its own so a run
    // still gets its interop number even when the witness below cannot be
    // derived.
    const constraintHash = fieldHex(computeConstraintHash(vector));

    // The private witness for nullifier derivation. Their SDK is explicit that
    // it must be known only to the agent — and a value derived purely from the
    // run id and the wallet would be known to everyone, since both are public.
    // Mixing in server secret material is what actually makes it a witness.
    const secret = process.env.AUTH_SECRET?.trim();
    if (!secret) {
      // Fail closed on the private half rather than mint a guessable witness
      // that a real proof would later be built on.
      return { constraintHash, outputCommitment: null, salt: null };
    }

    // A fresh salt per run. Their SDK is explicit that reusing one across
    // commitments with different outputs leaks information about those outputs.
    const salt = generateSalt();

    // computeHashes wants a task account and an agent key. There is no AgenC
    // task here — this is an Aemulus run — so the run stands in as the task
    // identity and the owner's wallet is the agent, which is literally true.
    const taskPda = new PublicKey(
      Buffer.from(createHash("sha256").update(`aemulus:task:${run.id}`).digest()),
    );
    const agent = publicKeyOrNull(PublicKey, run.owner);
    if (!agent) return { constraintHash, outputCommitment: null, salt: null };

    const agentSecret =
      BigInt(
        `0x${createHash("sha256")
          .update(`aemulus:witness:${secret}:${run.id}:${run.owner}`)
          .digest("hex")}`,
      ) % FIELD_MODULUS;

    const res = computeHashes(taskPda, agent, vector, salt, agentSecret);

    return {
      constraintHash,
      outputCommitment: fieldHex(res.outputCommitment),
      salt: fieldHex(salt),
    };
  } catch (e) {
    logError("agenc.commit", e, { run: run.id });
    return null;
  }
}

/** An owner is a base58 wallet everywhere in this app, but never assume. */
function publicKeyOrNull(
  PK: typeof import("@solana/web3.js").PublicKey,
  raw: string,
): InstanceType<typeof PK> | null {
  try {
    return new PK(raw);
  } catch {
    return null;
  }
}

/**
 * Recompute a run's constraint hash from public receipt data and compare.
 *
 * The whole point of using their canonical hashing rather than inventing our
 * own is that this check can be done by somebody else, with their SDK, without
 * asking us anything.
 */
export async function verifyConstraintHash(
  run: Parameters<typeof outputVector>[0],
  expected: string,
): Promise<boolean> {
  try {
    const { computeConstraintHash, FIELD_MODULUS } = await import("@tetsuo-ai/sdk");
    const got = fieldHex(computeConstraintHash(outputVector(run, FIELD_MODULUS)));
    // Compare padded on BOTH sides. Runs written before this was fixed hold an
    // unpadded hash, and re-padding only what we compute would break their
    // verification — the value is right, only its width was wrong.
    return got === expected.padStart(64, "0");
  } catch (e) {
    logError("agenc.verify", e, { run: run.id });
    return false;
  }
}
