import { NextResponse } from "next/server";
import { matchDecisionSchema } from "@/lib/schemas";
import { assertSameOrigin, errorResponse, readJson } from "@/server/http";
import { reviewMatch } from "@/server/service";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; matchId: string }> }) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  try {
    const { id, matchId } = await ctx.params;
    const body = matchDecisionSchema.safeParse(await readJson(req, 16 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 });
    return NextResponse.json(reviewMatch({ runId: id, matchId, ...body.data }));
  } catch (e) {
    return errorResponse(e);
  }
}
