import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/qbo/oauth";
import { getApSession } from "@/lib/ap-controls/ap-session";
import { QBO_STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Intuit redirects here with ?code, ?realmId, ?state. Verify the CSRF state,
// exchange the code for tokens, then return to the queue with a status flag.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const cookieState = (await cookies()).get(QBO_STATE_COOKIE)?.value;

  const back = new URL("/ap/queue", url.origin);

  if (!code || !realmId || !state || !cookieState || state !== cookieState) {
    back.searchParams.set("qbo", "error");
    const res = NextResponse.redirect(back);
    res.cookies.delete(QBO_STATE_COOKIE);
    return res;
  }

  try {
    const session = await getApSession().catch(() => null);
    await exchangeCode(code, realmId, Date.now(), session?.workspaceId);
    back.searchParams.set("qbo", "connected");
  } catch {
    back.searchParams.set("qbo", "error");
  }
  const res = NextResponse.redirect(back);
  res.cookies.delete(QBO_STATE_COOKIE);
  return res;
}
