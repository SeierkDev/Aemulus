import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { db, ready } from "./db";
import { DATA_ROOT } from "./paths";
import { shotsEnabled, storeBytes } from "./arweave";
import { logError, logInfo } from "./log";

/**
 * Permanent screenshot storage.
 *
 * A receipt already commits to the sha256 of every proof screenshot, so the
 * batch bundle on Arweave proves what each image hashed to. That makes a
 * screenshot you still hold checkable forever — but it does not get the image
 * back if we are gone. This stores the pixels themselves.
 *
 * Two things make this different from storing bundles, and both shape the
 * design:
 *
 * It is not free. A bundle is a few tens of KB of hashes; a real screenshot at
 * the runner's 1280x800 viewport measures ~90 KB for a text page and ~440 KB
 * for an image-heavy one, so most land past the free tier and cost money.
 *
 * It is not private. Arweave is permanent and public, with no delete. A run's
 * screenshots routinely contain invoices, vendor names, amounts and whatever
 * else sat on a logged-in page, and public verification has always deliberately
 * excluded screenshots. So this is opt-in per run and off by default. Nothing
 * here ever picks up a run the owner did not explicitly publish.
 */

/**
 * The bytes are uploaded exactly as captured — no re-encoding, ever.
 *
 * Recompressing a PNG to WebP would cut most screenshots under the free tier,
 * which is tempting and completely wrong: the receipt commits to the hash of
 * the original bytes, so a re-encoded copy would hash to something else and be
 * unverifiable against the very receipt that makes it worth keeping. Storing
 * something cheaper than the thing you promised to prove is not storing it.
 */
const MAX_SHOT_BYTES = 4 * 1024 * 1024;

/**
 * Ceiling on how much one sweep will upload. Paid uploads driven by an
 * automated batcher are exactly how a balance quietly empties overnight, so the
 * spend is bounded per pass and what got left behind is logged rather than
 * silently dropped.
 */
export const SWEEP_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * How many passes a run gets before the sweep stops picking it up. Bounded so a
 * screenshot that can never be stored — too large, or gone from disk — stops
 * blocking every run behind it, while a transient failure still heals.
 */
const MAX_ATTEMPTS = 5;

let sweeping = false;

/** Where a stored screenshot lives, readable by anyone with no account. */
export function shotUrl(txId: string): string {
  return `https://arweave.net/${txId}`;
}

/**
 * Content hash of a stored screenshot — the same sha256 the receipt commits to,
 * so the two always agree about what a given image is.
 */
async function hashFile(rel: string): Promise<{ hash: string; buf: Buffer } | null> {
  try {
    const abs = path.join(DATA_ROOT, rel);
    const info = await stat(abs);
    // Checked before reading: a corrupt or unexpectedly huge file should not be
    // pulled into memory just to be rejected afterwards.
    if (info.size > MAX_SHOT_BYTES) {
      logInfo("arweave.shot.skip", "screenshot too large", { rel, bytes: info.size });
      return null;
    }
    const buf = await readFile(abs);
    return { hash: createHash("sha256").update(buf).digest("hex"), buf };
  } catch {
    return null; // missing or unreadable — nothing to store
  }
}

/**
 * Transactions holding these screenshots, by content hash. Batched on purpose:
 * public verification calls this for every step of a published run, and one
 * query per screenshot turns an open endpoint into a per-request fan-out.
 */
export async function shotTxs(hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(hashes.filter(Boolean))];
  if (!wanted.length) return out;
  await ready();
  const r = await db.execute({
    sql: `SELECT hash, tx_id FROM arweave_shots
          WHERE hash IN (${wanted.map(() => "?").join(",")})`,
    args: wanted,
  });
  for (const row of r.rows) out.set(String(row.hash), String(row.tx_id));
  return out;
}

/** The transaction holding a screenshot with this content hash, if any. */
export async function shotTx(hash: string): Promise<string | null> {
  if (!hash) return null;
  await ready();
  const r = await db.execute({
    sql: `SELECT tx_id FROM arweave_shots WHERE hash = ?`,
    args: [hash],
  });
  const row = r.rows[0];
  return row ? String(row.tx_id) : null;
}

/**
 * Store one screenshot, or return the transaction that already holds it.
 *
 * Deduplicated by content hash. Proof runs revisit the same pages constantly
 * and produce byte-identical images, so without this the same screenshot would
 * be paid for and permanently duplicated once per run.
 */
async function storeShot(rel: string): Promise<{ tx: string; bytes: number } | null> {
  const file = await hashFile(rel);
  if (!file) return null;

  const existing = await shotTx(file.hash);
  if (existing) return { tx: existing, bytes: 0 };

  const tx = await storeBytes(
    file.buf,
    [
      { name: "Content-Type", value: "image/png" },
      { name: "App-Name", value: "Aemulus" },
      { name: "Type", value: "run-screenshot" },
      // Tagged with the hash the receipt commits to, and nothing that ties it
      // to a run or an owner. That is the whole discovery path: someone holding
      // a receipt searches this tag and finds the image, with no database and
      // no help from us — while a stranger reading Arweave learns nothing about
      // whose run it was.
      { name: "Shot-Hash", value: file.hash },
    ],
    // Screenshots are normally past the free tier. Paying is the point here,
    // and it is bounded by the caller's budget.
    { label: file.hash.slice(0, 12), allowPaid: true },
  );
  if (!tx) return null;

  await db.execute({
    sql: `INSERT INTO arweave_shots (hash, tx_id, bytes, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(hash) DO NOTHING`,
    args: [file.hash, tx, file.buf.length, Date.now()],
  });
  return { tx, bytes: file.buf.length };
}

export interface ArchiveResult {
  stored: number;
  deduped: number;
  bytes: number;
  /** Left for a later pass because this one ran out of budget. */
  deferred: number;
}

/**
 * Archive the screenshots of a single run the owner published.
 *
 * Never throws. Permanence is an addition to a proof, not a precondition for
 * it, so nothing here may break run settlement or batching.
 */
export async function archiveRunShots(
  runId: string,
  budget = SWEEP_BUDGET_BYTES,
): Promise<ArchiveResult> {
  const out: ArchiveResult = { stored: 0, deduped: 0, bytes: 0, deferred: 0 };
  if (!shotsEnabled()) return out;
  try {
    await ready();
    // The opt-in is re-read here rather than trusted from the caller: this is
    // the last gate before an irreversible public upload.
    const r = await db.execute({
      sql: `SELECT s.screenshot AS rel FROM run_steps s
            JOIN runs r ON r.id = s.run_id
            WHERE s.run_id = ? AND r.shots_public = 1
              AND s.screenshot IS NOT NULL AND s.screenshot != ''
            ORDER BY s.idx ASC`,
      args: [runId],
    });

    let failed = 0;
    for (const row of r.rows) {
      if (out.bytes >= budget) {
        out.deferred++;
        continue;
      }
      const res = await storeShot(String(row.rel));
      if (!res) {
        failed++;
        continue;
      }
      if (res.bytes === 0) out.deduped++;
      else {
        out.stored++;
        out.bytes += res.bytes;
      }
    }

    // Every pass counts, so a run that keeps failing eventually stops being
    // picked up instead of starving the ones behind it.
    if (r.rows.length) {
      await db.execute({
        sql: `UPDATE runs SET shots_attempts = shots_attempts + 1 WHERE id = ?`,
        args: [runId],
      });
    }
    // Done only when nothing was left behind. A partial pass stays unmarked so
    // the next sweep finishes it.
    if (r.rows.length && !out.deferred && !failed) {
      await db.execute({
        sql: `UPDATE runs SET shots_archived_at = ? WHERE id = ?`,
        args: [Date.now(), runId],
      });
    }

    if (out.stored || out.deferred || failed) {
      logInfo("arweave.shots", runId, {
        ...out,
        failed,
      } as unknown as Record<string, unknown>);
    }
    return out;
  } catch (e) {
    logError("arweave.shots", e, { run: runId });
    return out;
  }
}

/**
 * Pick up published runs whose screenshots were never stored, so one failed
 * upload does not mean that run's evidence is silently never permanent.
 */
export async function sweepShots(limit = 5): Promise<ArchiveResult> {
  const out: ArchiveResult = { stored: 0, deduped: 0, bytes: 0, deferred: 0 };
  if (!shotsEnabled() || sweeping) return out;
  sweeping = true;
  try {
    await ready();
    // Published runs that are NOT finished yet. The archived-at and attempts
    // filters are what let the sweep move on: without them it re-reads the same
    // newest few runs on every tick and never reaches an older one behind them.
    const r = await db.execute({
      sql: `SELECT DISTINCT r.id FROM runs r
            JOIN run_steps s ON s.run_id = r.id
            WHERE r.shots_public = 1
              AND r.shots_archived_at IS NULL
              AND r.shots_attempts < ?
              AND s.screenshot IS NOT NULL AND s.screenshot != ''
            ORDER BY r.created_at DESC LIMIT ?`,
      args: [MAX_ATTEMPTS, Math.max(1, Math.min(50, limit))],
    });
    for (const row of r.rows) {
      if (out.bytes >= SWEEP_BUDGET_BYTES) {
        out.deferred++;
        continue;
      }
      const one = await archiveRunShots(String(row.id), SWEEP_BUDGET_BYTES - out.bytes);
      out.stored += one.stored;
      out.deduped += one.deduped;
      out.bytes += one.bytes;
      out.deferred += one.deferred;
    }
    return out;
  } catch (e) {
    logError("arweave.shots.sweep", e);
    return out;
  } finally {
    sweeping = false;
  }
}

/**
 * Publish a run's screenshots permanently. Owner-only, and deliberately not
 * reversible in the way callers might expect: clearing the flag stops future
 * uploads but cannot unpublish anything already on Arweave.
 */
export async function setShotsPublic(
  runId: string,
  owner: string,
  isPublic: boolean,
): Promise<boolean> {
  await ready();
  // Publishing resets the progress markers so a run that previously gave up
  // (or was unpublished and published again) gets a fresh set of attempts.
  const r = await db.execute({
    sql: `UPDATE runs SET shots_public = ?, shots_archived_at = NULL, shots_attempts = 0
          WHERE id = ? AND owner = ?`,
    args: [isPublic ? 1 : 0, runId, owner],
  });
  return r.rowsAffected > 0;
}
