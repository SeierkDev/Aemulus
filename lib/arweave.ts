import { logError, logInfo } from "./log";

/**
 * Permanent proof storage.
 *
 * Every run already leaves a receipt anyone can verify, but that receipt lives
 * in our database — so the proof lasts exactly as long as this company does,
 * which is a strange thing for a proof to depend on. This uploads each Merkle
 * batch's bundle to Arweave, where it is written once and kept whether or not
 * we are still here.
 *
 * The bundle is the right unit, not the individual receipt. It is already
 * self-contained and verifiable offline — the root, every leaf hash, and every
 * Merkle proof — so one upload makes a whole batch of runs independently
 * checkable. buildBatchBundle's own comment anticipated this: "pin it to
 * Arweave/IPFS and the receipts outlive this service."
 *
 * Inert without a key, exactly like anchoring and payouts: a missing signer
 * means batches simply carry no Arweave id, never an exception in the batcher.
 */

/**
 * Turbo uploads data items under 100 KiB for free. A bundle is a few KB of
 * hashes, so it sits comfortably under that — but a very large batch could
 * cross it, and crossing it means the upload is CHARGED against a balance that
 * may be empty. So the size is checked first and an oversized bundle is skipped
 * with a log rather than silently failing or silently costing money.
 *
 * Set below the real limit to leave room for the data item's own envelope.
 */
export const FREE_LIMIT_BYTES = 96 * 1024;

/**
 * Bound the upload. It is awaited inside the receipt batcher's tick, so a
 * hanging third party would stall batching indefinitely — the same reason
 * anchoring has ANCHOR_TIMEOUT_MS.
 */
const UPLOAD_TIMEOUT_MS = 30_000;

export function arweaveEnabled(): boolean {
  return !!process.env.AEMULUS_ARWEAVE_KEY;
}

/**
 * Screenshot archiving, off unless explicitly switched on.
 *
 * Separate from arweaveEnabled because the two carry different risks. Bundles
 * are hashes — public already, and free. Screenshots are the actual pixels of a
 * logged-in page, they cost real money above the free tier, and Arweave has no
 * delete. Turning receipts on must not drag this along with it.
 */
export function shotsEnabled(): boolean {
  return arweaveEnabled() && process.env.AEMULUS_ARWEAVE_SHOTS === "1";
}

/**
 * Where a stored bundle can be read, by anyone, with no account.
 *
 * The gateway 302s to a content-addressed subdomain, which browsers follow —
 * verified against a real upload. Note it is NOT readable the instant an upload
 * returns: a live probe found the transaction accepted immediately but still
 * unserved a minute later, so anything showing this link has to say so rather
 * than let a fresh proof look broken.
 */
export function arweaveUrl(id: string): string {
  return `https://arweave.net/${id}`;
}

/**
 * Store a batch bundle permanently. Returns the Arweave transaction id, or null
 * when storage is off, the bundle is too large, or the upload failed.
 *
 * Never throws. This runs inside the receipt batcher, and a third party being
 * unreachable must not be able to stop receipts being batched — the batch is
 * already valid and verifiable without Arweave; permanence is an addition to
 * it, not a precondition.
 */
export async function storeBundle(
  batchId: string,
  bundle: unknown,
): Promise<string | null> {
  if (!arweaveEnabled()) return null;

  // A null/undefined bundle would serialise to the literal string "null",
  // sail through the size check, and be written to Arweave PERMANENTLY —
  // signed by our wallet, unretractable, and meaningless. buildBatchBundle
  // returns null for an unknown batch, so this is reachable, not theoretical.
  if (bundle == null || typeof bundle !== "object") {
    logInfo("arweave.skip", "nothing to store", { batch: batchId });
    return null;
  }

  const payload = Buffer.from(JSON.stringify(bundle), "utf8");
  return storeBytes(payload, [
    { name: "Content-Type", value: "application/json" },
    { name: "App-Name", value: "Aemulus" },
    { name: "Type", value: "receipt-batch" },
    { name: "Batch-Id", value: batchId },
    // Findable by tag alone. If our database is gone, the id is gone with it —
    // a tag search is the only way anyone gets back to this.
    { name: "Root", value: String((bundle as { root?: unknown }).root ?? "") },
  ], { label: batchId });
}

/**
 * Upload bytes and return the transaction id, or null if it could not be
 * stored. Never throws: this runs inside the receipt batcher, and a third party
 * being unreachable must not stop receipts being batched.
 *
 * Anything over the free tier is refused unless allowPaid says otherwise, so
 * the default behaviour can never quietly spend money.
 */
export async function storeBytes(
  payload: Buffer,
  tags: { name: string; value: string }[],
  opts: { label?: string; allowPaid?: boolean } = {},
): Promise<string | null> {
  const key = process.env.AEMULUS_ARWEAVE_KEY;
  if (!key) return null;

  if (payload.length > FREE_LIMIT_BYTES && !opts.allowPaid) {
    logInfo("arweave.skip", "over the free-tier limit", {
      label: opts.label,
      bytes: payload.length,
    });
    return null;
  }

  try {
    // The timeout covers the WHOLE path, not just the upload. The SDK's first
    // import costs a couple of seconds cold, and module resolution is exactly
    // the kind of thing that can stall unboundedly — leaving it outside the
    // bound meant the batcher could still hang on a step that isn't the network
    // call anyone thinks to guard.
    return await withTimeout(
      (async () => {
        // Imported lazily so the SDK's dependency graph stays out of memory on
        // every path that never uploads anything.
        const { TurboFactory, ArweaveSigner } = await import("@ardrive/turbo-sdk");
        const jwk = JSON.parse(key) as ConstructorParameters<typeof ArweaveSigner>[0];
        const turbo = TurboFactory.authenticated({ signer: new ArweaveSigner(jwk) });

        const res = await turbo.uploadFile({
          fileStreamFactory: () => payload,
          fileSizeFactory: () => payload.length,
          dataItemOpts: { tags },
        });
        logInfo("arweave.stored", res.id, {
          label: opts.label,
          bytes: payload.length,
        });
        return res.id;
      })(),
    );
  } catch (e) {
    logError("arweave.store", e, { label: opts.label });
    return null;
  }
}

/** Reject rather than hang forever if the upload never settles. */
function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      timer = setTimeout(
        () => rej(new Error("Arweave upload timed out")),
        UPLOAD_TIMEOUT_MS,
      );
    }),
    // Clearing matters: an uncleared 30s timer keeps the event loop alive long
    // after a fast upload has already returned.
  ]).finally(() => clearTimeout(timer));
}
