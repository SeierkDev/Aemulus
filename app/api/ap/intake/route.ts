import { NextResponse } from "next/server";
import { extractInvoice, type ExtractInput } from "@/lib/ap-controls/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

// Read an uploaded invoice (PDF / PNG / JPEG) with Claude vision and return the
// extracted fields for the user to confirm. Does not write anything — the
// confirm step (POST /api/ap/intake/enter) creates the sealed record.
export async function POST(req: Request) {
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
  else return NextResponse.json({ ok: false, error: "Unsupported file type — upload a PDF, PNG, or JPEG." }, { status: 415 });

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
