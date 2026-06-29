import { NextResponse } from "next/server";
import { buildBatchBundle } from "@/lib/receipt";

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
  return NextResponse.json(bundle, {
    headers: {
      "Content-Disposition": `attachment; filename="aemulus-batch-${id}.json"`,
    },
  });
}
