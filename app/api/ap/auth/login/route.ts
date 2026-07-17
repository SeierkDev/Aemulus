import { NextResponse } from "next/server";
import { findUserByEmail, verifyPassword } from "@/lib/ap-controls/accounts";
import { createApSessionToken, setApSessionCookie } from "@/lib/ap-controls/ap-session";
import { enforceRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A well-formed scrypt hash that no password matches — verified even when the
// email is unknown, so login timing doesn't reveal whether an account exists.
const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(`ap-login:${clientIp(req)}`, 10, 60_000, "Too many attempts");
  if (limited) return NextResponse.json({ ok: false, error: "Too many attempts — try again shortly." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email = String(body.email ?? "");
  const password = String(body.password ?? "");
  const user = await findUserByEmail(email);
  // Always run scrypt (dummy hash if no user) so timing is constant; same message
  // whether the email is unknown or the password is wrong.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    return NextResponse.json({ ok: false, error: "Wrong email or password." }, { status: 401 });
  }

  const token = await createApSessionToken({ userId: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId });
  const res = NextResponse.json({ ok: true, user: { email: user.email, name: user.name } });
  setApSessionCookie(res, token);
  return res;
}
