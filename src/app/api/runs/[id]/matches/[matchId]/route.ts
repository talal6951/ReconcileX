import { NextResponse } from "next/server";
import { matchDecisionSchema } from "@/lib/schemas";
import { readJson, withWorkspace } from "@/server/http";
import { reviewMatch } from "@/server/service";

export const runtime = "nodejs";

export const POST = withWorkspace<{ id: string; matchId: string }>(
  async (ctx, req, { id, matchId }) => {
    const body = matchDecisionSchema.safeParse(await readJson(req, 16 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 });
    return NextResponse.json(reviewMatch(ctx, { runId: id, matchId, ...body.data }));
  },
  { mutation: true },
);
