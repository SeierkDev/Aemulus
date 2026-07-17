import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { logError } from "@/lib/log";
import { createWebhook, listWebhooks, WebhookLimitError } from "@/lib/webhooks";
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
    const { id, secret } = await createWebhook(
      session.pubkey,
      parsed.data.url,
      parsed.data.events,
    );
    return NextResponse.json({ id, secret });
  } catch (err) {
    if (err instanceof WebhookLimitError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // assertSafeUrl throws on unsafe/private/unreachable URLs — return a GENERIC
    // message so this endpoint isn't a DNS oracle (distinct "private address" vs
    // "could not resolve" errors would leak whether an internal host exists).
    logError("api/webhooks", err);
    return NextResponse.json({ error: "That webhook URL isn't allowed." }, { status: 400 });
  }
}
