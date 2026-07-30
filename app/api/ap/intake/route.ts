import { NextResponse } from "next/server";
import { extractInvoice, type ExtractInput } from "@/lib/ap-controls/extract";
import { getApViewer } from "@/lib/ap-controls/ap-viewer";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

// Read an uploaded invoice (PDF / PNG / JPEG) with Claude vision and return the
// extracted fields for the user to confirm. Does not write anything - the
// confirm step (POST /api/ap/intake/enter) creates the sealed record.
// Auth-gated + rate-limited: this invokes a paid model call.
export async function POST(req: Request) {
  const viewer = await getApViewer().catch(() => null);
  if (!viewer) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const limited = enforceRateLimit(`ap-extract:${viewer.workspaceId}`, 10, 60_000, "Too many uploads");
  if (limited) return NextResponse.json({ ok: false, error: "Too many uploads - slow down." }, { status: 429 });

  // Reject an oversized upload by its declared size BEFORE formData() buffers the
  // whole multipart body into memory (App-Router handlers have no default cap).
  // The exact file.size is re-checked below (a multipart body is a bit larger).
  if (Number(req.headers.get("content-length") || 0) > MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "File is too large (max 12 MB)." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a multipart form upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File is too large (max 12 MB)." }, { status: 413 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  let input: ExtractInput;
  if (file.type === "application/pdf") input = { kind: "pdf", base64 };
  else if (file.type === "image/png") input = { kind: "image", base64, mediaType: "image/png" };
  else if (file.type === "image/jpeg") input = { kind: "image", base64, mediaType: "image/jpeg" };
  else return NextResponse.json({ ok: false, error: "Unsupported file type - upload a PDF, PNG, or JPEG." }, { status: 415 });

  try {
    const fields = await extractInvoice(input);
    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not read the invoice." },
      { status: 502 },
    );
  }
}
