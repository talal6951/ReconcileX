import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { verifyAudit } from "@/server/service";

export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json(verifyAudit(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
