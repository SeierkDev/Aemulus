import { NextResponse } from "next/server";
import { findUserByEmail, verifyPassword } from "@/lib/ap-controls/accounts";
import { createApSessionToken, setApSessionCookie } from "@/lib/ap-controls/ap-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email = String(body.email ?? "");
  const password = String(body.password ?? "");
  const user = await findUserByEmail(email);
  // Same message whether the email is unknown or the password is wrong.
  const ok = !!user && (await verifyPassword(password, user.passwordHash));
  if (!ok || !user) {
    return NextResponse.json({ ok: false, error: "Wrong email or password." }, { status: 401 });
  }

  const token = await createApSessionToken({ userId: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId });
  const res = NextResponse.json({ ok: true, user: { email: user.email, name: user.name } });
  setApSessionCookie(res, token);
  return res;
}
