import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { revokeApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoke an API key (owner only). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = await revokeApiKey(id, session.pubkey);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
