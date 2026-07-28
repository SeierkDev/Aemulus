import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { setCredential, listCredentials, VaultLimitError } from "@/lib/vault";
import { readJson, VaultBody } from "@/lib/validate";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List the wallet's stored credentials (metadata only, never values). */
export async function GET() {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ credentials: await listCredentials(session.pubkey) });
}

/** Store/replace a credential for a host. */
export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const parsed = await readJson(req, VaultBody);
    if (!parsed.ok) return parsed.res;
    const { host, key, value } = parsed.data;
    await setCredential(session.pubkey, host, key, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof VaultLimitError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    logError("api/vault", err);
    return NextResponse.json({ error: "Failed to save credential" }, { status: 500 });
  }
}
