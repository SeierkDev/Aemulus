import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

// AP account session — a JWT in an httpOnly cookie, signed with AUTH_SECRET
// (same primitive as the wallet session, but a distinct cookie + `typ` claim so
// the two never cross-authenticate).

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const AP_SESSION_COOKIE = "aem_ap_session";

export interface ApSessionUser {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

export async function createApSessionToken(u: ApSessionUser): Promise<string> {
  return new SignJWT({ typ: "ap", ...u })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyApSessionToken(token: string): Promise<ApSessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.typ !== "ap" || !payload.userId) return null;
    return {
      userId: String(payload.userId),
      email: String(payload.email),
      name: String(payload.name),
      workspaceId: String(payload.workspaceId),
    };
  } catch {
    return null;
  }
}

/** Current AP session from the cookie (server components / route handlers). */
export async function getApSession(): Promise<ApSessionUser | null> {
  const token = (await cookies()).get(AP_SESSION_COOKIE)?.value;
  return token ? verifyApSessionToken(token) : null;
}

export function setApSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(AP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearApSessionCookie(res: NextResponse): void {
  res.cookies.set(AP_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 0,
  });
}
