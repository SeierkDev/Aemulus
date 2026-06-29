import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { createWebhook, listWebhooks } from "@/lib/webhooks";
import { readJson, WebhookBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ webhooks: await listWebhooks(session.pubkey) });
}

/** Register a webhook. The signing secret is returned ONCE. */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const parsed = await readJson(req, WebhookBody);
  if (!parsed.ok) return parsed.res;
  try {
    const { id, secret } = await createWebhook(session.pubkey, parsed.data.url);
    return NextResponse.json({ id, secret });
  } catch (err) {
    // assertSafeUrl throws on unsafe/private/unreachable URLs
    logError("api/webhooks", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid webhook URL" },
      { status: 400 },
    );
  }
}
