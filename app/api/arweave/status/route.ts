import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { arweaveEnabled, arweaveUrl, shotsEnabled } from "@/lib/arweave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is permanent storage actually working?
 *
 * Without this the only way to answer that is to complete a run, wait for a
 * batch tick, and open its verify page — which is a long way to go to find out
 * whether a key is valid. Signed in only: the counts say how much this instance
 * has run, which is nobody else's business.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  await ready();

  const batches = await db.execute(
    `SELECT COUNT(*) AS total,
            COUNT(arweave_id) AS stored,
            MAX(created_at) AS newest
     FROM receipt_batches`,
  );
  const last = await db.execute(
    `SELECT id, arweave_id, created_at FROM receipt_batches
     WHERE arweave_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  );
  const shots = await db.execute(
    `SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM arweave_shots`,
  );

  const b = batches.rows[0];
  const total = Number(b?.total ?? 0);
  const stored = Number(b?.stored ?? 0);
  const l = last.rows[0];

  return NextResponse.json({
    receipts: {
      enabled: arweaveEnabled(),
      batchesTotal: total,
      batchesStored: stored,
      lastStored: l
        ? {
            batchId: String(l.id),
            txId: String(l.arweave_id),
            url: arweaveUrl(String(l.arweave_id)),
            at: Number(l.created_at),
          }
        : null,
    },
    screenshots: {
      enabled: shotsEnabled(),
      stored: Number(shots.rows[0]?.n ?? 0),
      bytes: Number(shots.rows[0]?.bytes ?? 0),
    },
    // Said plainly, because "0 stored" has several very different causes and
    // guessing between them is exactly what wastes an evening.
    hint: !arweaveEnabled()
      ? "AEMULUS_ARWEAVE_KEY is not set on this instance."
      : total === 0
        ? "No receipt batches exist yet, so there is nothing to store. Complete a run and wait for a batch."
        : stored === 0
          ? "Batches exist but none are stored. Either they all predate the key by more than 24h (the retry sweep only looks back a day), or uploads are failing — check the logs for arweave.store."
          : "Permanent receipt storage is working.",
  });
}
