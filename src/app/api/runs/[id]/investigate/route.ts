import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { ValidationError } from "@/server/repo";
import { investigate } from "@/server/service";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const matchId = url.searchParams.get("match") ?? undefined;
    const exceptionId = url.searchParams.get("exception") ?? undefined;
    if (!matchId === !exceptionId) throw new ValidationError("Specify exactly one of match or exception");
    return NextResponse.json(investigate(id, { matchId, exceptionId }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof Error && /^Unknown (match|exception)/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 404 });
    return errorResponse(e);
  }
}
