import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { createApiKey, listApiKeys, countActiveApiKeys, MAX_API_KEYS_PER_OWNER } from "@/lib/api-keys";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, ApiKeyBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List the signed-in wallet's API keys (metadata only). */
export async function GET() {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ keys: await listApiKeys(session.pubkey) });
}

/** Mint a new API key - the raw key is returned ONCE. */
export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(`apikey-create:${session.pubkey}`, 20, 60_000, "Too many keys");
    if (limited) return limited;
    const parsed = await readJson(req, ApiKeyBody);
    if (!parsed.ok) return parsed.res;
    if ((await countActiveApiKeys(session.pubkey)) >= MAX_API_KEYS_PER_OWNER) {
      return NextResponse.json({ error: `API key limit reached (max ${MAX_API_KEYS_PER_OWNER}).` }, { status: 409 });
    }
    const { key, meta } = await createApiKey(
      session.pubkey,
      parsed.data.name ?? "API key",
      parsed.data.scopes,
    );
    return NextResponse.json({ key, meta });
  } catch (err) {
    logError("api/keys", err);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
