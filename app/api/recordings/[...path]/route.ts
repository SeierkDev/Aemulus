import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join(process.cwd(), ".data", "recordings");

/**
 * Serve proof screenshots - but only your own. Screenshots are stored under
 * .data/recordings/<owner-pubkey>/<session-or-run-id>/..., so we require a
 * session and verify the first path segment is the caller's wallet. Prevents
 * cross-wallet access to another user's captured screens (IDOR).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { path: parts } = await params;
  // Reject traversal/separator segments BEFORE joining - otherwise
  // ["me","..","victim","x.png"] passes the parts[0] check and path.join
  // collapses it into another wallet's directory (cross-wallet IDOR).
  if (
    parts.length === 0 ||
    parts[0] !== session.pubkey ||
    parts.some(
      (p) => p === "" || p === "." || p === ".." || /[/\\]/.test(p),
    )
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  // Containment check against the caller's OWN directory, not just ROOT.
  const ownerRoot = path.join(ROOT, session.pubkey);
  const target = path.resolve(ROOT, ...parts);
  if (target !== ownerRoot && !target.startsWith(ownerRoot + path.sep)) {
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
