import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { deleteCredential } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = await deleteCredential(id, session.pubkey);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
