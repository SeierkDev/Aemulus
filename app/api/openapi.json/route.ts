import { NextResponse } from "next/server";
import { OPENAPI } from "@/lib/openapi";

export const runtime = "nodejs";

/** Public OpenAPI 3.0 description of the Aemulus protocol. */
export function GET() {
  return NextResponse.json(OPENAPI);
}
