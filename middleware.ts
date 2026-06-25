import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Gate the functional app behind a signed-in wallet (and, once gating is on,
 * a sufficient $MIMIC balance encoded as `level` in the session JWT).
 *
 * Edge-safe: verifies the JWT inline with jose (no Node-only imports). Must
 * keep the cookie name + secret fallback in sync with lib/auth.ts.
 */
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "mimic-dev-secret-change-me",
);

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("mimic_session")?.value;
  let level = -1;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, SECRET);
      level = Number(payload.level);
    } catch {
      level = -1;
    }
  }

  if (level < 0) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("signin", "1");
    return NextResponse.redirect(url);
  }
  if (level < 1) {
    const url = req.nextUrl.clone();
    url.pathname = "/gated";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/record", "/skills", "/skills/:path*", "/runs", "/runs/:path*"],
};
