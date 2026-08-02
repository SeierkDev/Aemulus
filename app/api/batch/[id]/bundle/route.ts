import { NextResponse } from "next/server";
import { buildBatchBundle } from "@/lib/receipt";
import { arweaveUrl } from "@/lib/arweave";
import { getBatch } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, downloadable proof bundle for a Merkle batch - self-contained and
 * content-addressed (bundleHash). No private data; verifiable offline.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bundle = await buildBatchBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  // Advertised in a header rather than folded into the body, so this response
  // stays exactly the bundle it claims to be. The permanent copy is the same
  // batch in its archive form — same root, same leaves, same bundleHash, with
  // the derivable proofs left out — so it is an alternate representation, not a
  // byte-for-byte canonical one.
  const batch = await getBatch(id);
  const headers: Record<string, string> = {
    "Content-Disposition": `attachment; filename="aemulus-batch-${id}.json"`,
  };
  if (batch?.arweaveId) {
    headers["X-Arweave-Id"] = batch.arweaveId;
    headers["Link"] = `<${arweaveUrl(batch.arweaveId)}>; rel="alternate"`;
  }
  return NextResponse.json(bundle, { headers });
}
