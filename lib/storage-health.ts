import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "./paths";

/**
 * Can this process actually write to .data?
 *
 * Worth its own module because the answer was assumed rather than checked, and
 * being wrong about it is silent. The image creates /app/.data and chowns it to
 * the non-root user it then drops to — but that happens at BUILD time. A volume
 * mounted at the same path arrives at RUN time, owned by root, and shadows the
 * directory the chown fixed. Every write then fails with EACCES: recordings
 * cannot start, and run screenshots never land, which surfaces much later as a
 * receipt that verifies as "altered" because its evidence is missing.
 *
 * None of that reaches a health check that only pings the database, so an
 * instance that cannot store anything reports itself perfectly healthy.
 */

export type StorageHealth = { writable: boolean; reason?: string };

let cached: { at: number; result: StorageHealth } | null = null;

/** Re-probed at most this often: /api/health is polled, and this touches disk. */
const TTL_MS = 30_000;

export async function storageWritable(now: number = Date.now()): Promise<StorageHealth> {
  if (cached && now - cached.at < TTL_MS) return cached.result;
  const result = await probe();
  cached = { at: now, result };
  return result;
}

/** Forget the cached answer. Used by tests, and after a repair attempt. */
export function resetStorageHealth(): void {
  cached = null;
}

async function probe(): Promise<StorageHealth> {
  // A real create-write-delete rather than an access() check: the mounted-volume
  // case fails on the write, and access() on the parent would pass.
  const probeFile = path.join(DATA_ROOT, ".write-probe");
  try {
    await mkdir(DATA_ROOT, { recursive: true });
    await writeFile(probeFile, String(process.pid));
    await unlink(probeFile);
    return { writable: true };
  } catch (e) {
    return { writable: false, reason: codeOf(e) };
  }
}

function codeOf(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code === "EACCES" || code === "EPERM") {
    // The one failure with a specific, actionable cause.
    return "permission denied — a volume mounted over .data is owned by root";
  }
  if (code === "EROFS") return "the filesystem is read-only";
  if (code === "ENOSPC") return "the disk is full";
  return code ?? (e instanceof Error ? e.message : "unknown");
}
