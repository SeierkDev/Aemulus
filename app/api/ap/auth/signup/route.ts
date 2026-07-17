import { NextResponse } from "next/server";
import { createUser, AccountError } from "@/lib/ap-controls/accounts";
import { createApSessionToken, setApSessionCookie } from "@/lib/ap-controls/ap-session";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(`ap-signup:${clientIp(req)}`, 5, 60_000, "Too many sign-ups");
  if (limited) return NextResponse.json({ ok: false, error: "Too many sign-ups — try again shortly." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const user = await createUser({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      name: body.name ? String(body.name) : undefined,
      now: Date.now(),
    });
    const token = await createApSessionToken({ userId: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId });
    const res = NextResponse.json({ ok: true, user: { email: user.email, name: user.name } });
    setApSessionCookie(res, token);
    return res;
  } catch (e) {
    if (e instanceof AccountError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Could not create your account." }, { status: 500 });
  }
}
