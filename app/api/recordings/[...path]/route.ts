import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join(process.cwd(), ".data", "recordings");

/** Serve recording screenshots from .data/recordings (proof images). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await params;
  const target = path.join(ROOT, ...parts);
  // Prevent path traversal outside the recordings root.
  if (!target.startsWith(ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const buf = await readFile(target);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
