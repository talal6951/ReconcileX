import { NextResponse } from "next/server";
import { withWorkspace } from "@/server/http";
import { ValidationError } from "@/server/repo";
import { investigate } from "@/server/service";

export const runtime = "nodejs";

export const GET = withWorkspace<{ id: string }>((ctx, req, { id }) => {
  const url = new URL(req.url);
  const matchId = url.searchParams.get("match") ?? undefined;
  const exceptionId = url.searchParams.get("exception") ?? undefined;
  if (!matchId === !exceptionId) throw new ValidationError("Specify exactly one of match or exception");
  try {
    return NextResponse.json(investigate(ctx, id, { matchId, exceptionId }));
  } catch (e) {
    if (e instanceof Error && /^Unknown (match|exception)/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
});
