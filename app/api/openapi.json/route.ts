import { NextResponse } from "next/server";
import { OPENAPI } from "@/lib/openapi";
import { publicBaseUrl } from "@/lib/public-url";

export const runtime = "nodejs";

/** Public OpenAPI 3.0 description of the Aemulus protocol. */
export function GET() {
  // Point the spec's server at wherever the app actually runs.
  return NextResponse.json({ ...OPENAPI, servers: [{ url: publicBaseUrl() }] });
}
