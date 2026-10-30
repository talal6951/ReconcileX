import { NextResponse } from "next/server";
import { exceptionDecisionSchema } from "@/lib/schemas";
import { assertSameOrigin, errorResponse, readJson } from "@/server/http";
import { reviewException } from "@/server/service";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; exceptionId: string }> }) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  try {
    const { id, exceptionId } = await ctx.params;
    const body = exceptionDecisionSchema.safeParse(await readJson(req, 16 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 });
    return NextResponse.json(reviewException({ runId: id, exceptionId, ...body.data }));
  } catch (e) {
    return errorResponse(e);
  }
}
