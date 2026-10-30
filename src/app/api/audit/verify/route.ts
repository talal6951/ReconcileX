import { NextResponse } from "next/server";
import { withWorkspace } from "@/server/http";
import { verifyAudit } from "@/server/service";

export const runtime = "nodejs";

export const GET = withWorkspace((ctx) => NextResponse.json(verifyAudit(ctx)));
