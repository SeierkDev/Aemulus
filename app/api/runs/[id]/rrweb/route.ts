import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { getRun } from "@/lib/runs";
import { rrwebPath } from "@/lib/rrweb-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS_DIR = path.join(process.cwd(), ".data", "recordings");

/**
 * Serve a run's captured rrweb events for the interactive replay - owner only.
 * The events are stored gzipped; we hand them back with Content-Encoding: gzip
 * so the browser inflates them transparently.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run || run.owner !== session.pubkey) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const gz = await readFile(rrwebPath(RUNS_DIR, run.owner, id));
    return new Response(new Uint8Array(gz), {
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
