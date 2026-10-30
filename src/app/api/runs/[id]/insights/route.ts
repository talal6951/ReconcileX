import { NextResponse } from "next/server";
import { withWorkspace } from "@/server/http";
import { runInsights } from "@/server/service";

export const runtime = "nodejs";

export const GET = withWorkspace<{ id: string }>((ctx, _req, { id }) => NextResponse.json(runInsights(ctx, id)));
