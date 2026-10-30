import { NextResponse } from "next/server";
import { exceptionDecisionSchema } from "@/lib/schemas";
import { readJson, withWorkspace } from "@/server/http";
import { reviewException } from "@/server/service";

export const runtime = "nodejs";

export const POST = withWorkspace<{ id: string; exceptionId: string }>(
  async (ctx, req, { id, exceptionId }) => {
    const body = exceptionDecisionSchema.safeParse(await readJson(req, 16 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 });
    return NextResponse.json(reviewException(ctx, { runId: id, exceptionId, ...body.data }));
  },
  { mutation: true },
);
